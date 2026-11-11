// JS-rendering fallback, used ONLY for the single submitted website, and
// ONLY when static HTML is missing essential content. This never reaches
// consumer ChatGPT/Gemini surfaces — it renders the interviewee's own public
// site. Failures (Chromium not installed, launch timeout) degrade silently
// to "fallback unavailable" so the crawl still completes on static HTML.
import { assertResolvesToPublicAddress, UnsafeUrlError } from "@/lib/security/url-safety";
import { CRAWLER_USER_AGENT } from "./robots";

export interface PlaywrightRenderResult {
  ok: boolean;
  html?: string;
  reason?: string;
}

let cachedAvailability: boolean | null = null;

export async function isPlaywrightChromiumAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    cachedAvailability = true;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Body markup of the page's same-site frames. A menu embedded as an iframe of
 * the ordering app on the same host (nawab.ae/menu framing
 * nawab.ae/order-online/menu) is invisible to `page.content()`, so the render
 * once "found" 36 words on a page showing 150 dishes. Cross-site frames (maps,
 * chat widgets, ad sandboxes) stay out.
 */
async function sameSiteFrameHtml(page: import("playwright").Page, url: string): Promise<string[]> {
  const host = hostOf(url);
  const parts: string[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameUrl = frame.url();
    if (!host || !frameUrl || hostOf(frameUrl) !== host) continue;
    try {
      const inner = await frame.evaluate(() => document.body?.innerHTML ?? "");
      if (inner.trim().length > 0) parts.push(`<section data-sun-frame="${frameUrl.replace(/"/g, "&quot;")}">${inner}</section>`);
    } catch {
      // A frame that navigated away or refused evaluation contributes nothing.
    }
  }
  return parts;
}

/** The page's markup with same-site frame bodies appended inside <body>. Exported for tests. */
export function mergeFrames(html: string, frames: string[]): string {
  if (frames.length === 0) return html;
  const joined = frames.join("");
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${joined}</body>`) : `${html}${joined}`;
}

export async function renderWithPlaywright(url: string, timeoutMs: number): Promise<PlaywrightRenderResult> {
  try {
    const parsed = new URL(url);
    await assertResolvesToPublicAddress(parsed.hostname);
  } catch (err) {
    return { ok: false, reason: err instanceof UnsafeUrlError ? err.code : "unsafe_url" };
  }

  let browser: import("playwright").Browser | undefined;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true, timeout: timeoutMs });
    const context = await browser.newContext({ userAgent: CRAWLER_USER_AGENT });
    const page = await context.newPage();
    // `domcontentloaded` + a short settle beats `networkidle`, which never
    // fires on sites holding open analytics or chat sockets.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("load", { timeout: Math.min(timeoutMs, 6_000) }).catch(() => undefined);
    // Settle until the visible text stops growing (menus and product grids
    // arrive from their own APIs a second or two after load): a fixed 600 ms
    // read 56 words of a restaurant's menu page that reaches 2,600 by 3 s.
    let lastLength = -1;
    for (let poll = 0; poll < 8; poll += 1) {
      await page.waitForTimeout(poll === 0 ? 600 : 500);
      const length = await page.evaluate(() => document.body?.innerText.length ?? 0).catch(() => 0);
      if (length === lastLength) break;
      lastLength = length;
    }
    const html = mergeFrames(await page.content(), await sameSiteFrameHtml(page, url));
    await browser.close();
    return { ok: true, html };
  } catch (err) {
    if (browser) await browser.close().catch(() => undefined);
    return { ok: false, reason: (err as Error).message?.slice(0, 200) ?? "playwright_render_failed" };
  }
}
