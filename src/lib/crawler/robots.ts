// RFC 9309 (Robots Exclusion Protocol) parsing and matching.
//
// The parts real sites depend on and naive parsers get wrong:
//   * `*` and `$` wildcards inside rule paths;
//   * longest-match wins, with Allow beating Disallow on an equal-length tie;
//   * consecutive User-agent lines forming ONE group;
//   * the most specific matching user-agent group wins, `*` is the fallback;
//   * percent-encoding differences between the rule and the request path.

export const CRAWLER_USER_AGENT = "ProjectSunBot/1.0 (+https://projectsun.local/bot; onboarding-crawl)";
const CRAWLER_TOKEN = "projectsunbot";

export interface RobotsPolicy {
  fetched: boolean;
  httpStatus?: number;
  sitemaps: string[];
  crawlDelayMs: number;
  /** The user-agent group these rules came from, for the run record. */
  matchedAgent: string | null;
  isAllowed(pathWithQuery: string): boolean;
}

interface Rule {
  pattern: string;
  allow: boolean;
  /** Specificity for tie-breaking: length of the literal pattern. */
  length: number;
}

interface ParsedRobots {
  groups: Map<string, Rule[]>;
  crawlDelays: Map<string, number>;
  sitemaps: string[];
}

export function parseRobotsTxt(body: string): ParsedRobots {
  const groups = new Map<string, Rule[]>();
  const crawlDelays = new Map<string, number>();
  const sitemaps: string[] = [];
  let currentAgents: string[] = [];
  // Per RFC 9309 §2.2.1, consecutive User-agent lines form one group; a rule
  // line closes the group so the next User-agent starts a new one.
  let groupOpen = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      if (!groupOpen) currentAgents = [];
      const agent = value.toLowerCase();
      currentAgents.push(agent);
      if (!groups.has(agent)) groups.set(agent, []);
      groupOpen = true;
      continue;
    }

    if (field === "sitemap") {
      sitemaps.push(value);
      continue;
    }

    const agents = currentAgents.length > 0 ? currentAgents : ["*"];
    if (field === "disallow" || field === "allow") {
      groupOpen = false;
      for (const agent of agents) {
        const list = groups.get(agent) ?? [];
        // An empty Disallow means "allow everything" and carries no path.
        if (value === "") {
          if (field === "disallow") list.push({ pattern: "/", allow: true, length: 0 });
        } else {
          list.push({ pattern: value, allow: field === "allow", length: value.replace(/[*$]/g, "").length });
        }
        groups.set(agent, list);
      }
      continue;
    }

    if (field === "crawl-delay") {
      groupOpen = false;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        for (const agent of agents) crawlDelays.set(agent, seconds);
      }
    }
  }

  return { groups, crawlDelays, sitemaps };
}

/** Converts a robots path pattern (with `*` and `$`) to an anchored regex. */
export function robotsPatternToRegex(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      source += ".*";
    } else if (ch === "$" && i === pattern.length - 1) {
      source += "$";
    } else {
      source += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}`);
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function pathAllowed(pathWithQuery: string, rules: Rule[]): boolean {
  if (rules.length === 0) return true;
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const decoded = decodeSafely(path);

  let best: Rule | null = null;
  for (const rule of rules) {
    const regex = robotsPatternToRegex(rule.pattern);
    if (!regex.test(path) && !regex.test(decoded)) continue;
    if (!best) {
      best = rule;
      continue;
    }
    if (rule.length > best.length) best = rule;
    // Equal specificity: Allow wins, per RFC 9309 §2.2.2.
    else if (rule.length === best.length && rule.allow && !best.allow) best = rule;
  }
  return best ? best.allow : true;
}

/** Picks the most specific matching user-agent group for our token. */
export function selectAgentGroup(groups: Map<string, Rule[]>): { agent: string | null; rules: Rule[] } {
  if (groups.has(CRAWLER_TOKEN)) return { agent: CRAWLER_TOKEN, rules: groups.get(CRAWLER_TOKEN)! };
  let best: { agent: string; rules: Rule[] } | null = null;
  for (const [agent, rules] of groups) {
    if (agent === "*") continue;
    if (!CRAWLER_TOKEN.startsWith(agent)) continue;
    if (!best || agent.length > best.agent.length) best = { agent, rules };
  }
  if (best) return best;
  if (groups.has("*")) return { agent: "*", rules: groups.get("*")! };
  return { agent: null, rules: [] };
}

export async function fetchRobotsPolicy(origin: string, signal: AbortSignal): Promise<RobotsPolicy> {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, { headers: { "user-agent": CRAWLER_USER_AGENT }, redirect: "follow", signal });
    if (!res.ok) {
      // 4xx means "no restrictions published"; 5xx is ambiguous but treating
      // it as blocking would make a transient outage look like a robots ban.
      return { fetched: false, httpStatus: res.status, sitemaps: [], crawlDelayMs: 0, matchedAgent: null, isAllowed: () => true };
    }
    const body = (await res.text()).slice(0, 512_000);
    const { groups, crawlDelays, sitemaps } = parseRobotsTxt(body);
    const { agent, rules } = selectAgentGroup(groups);
    const delaySeconds = (agent ? crawlDelays.get(agent) : undefined) ?? crawlDelays.get("*") ?? 0;
    return {
      fetched: true,
      httpStatus: res.status,
      sitemaps,
      // Cap the honoured delay: a site advertising 30s would otherwise stall
      // the whole onboarding run. Recorded on the crawl run either way.
      crawlDelayMs: Math.min(delaySeconds * 1000, 5_000),
      matchedAgent: agent,
      isAllowed: (pathWithQuery: string) => pathAllowed(pathWithQuery, rules),
    };
  } catch {
    return { fetched: false, sitemaps: [], crawlDelayMs: 0, matchedAgent: null, isAllowed: () => true };
  }
}
