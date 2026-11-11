// A small, safe reading of the markdown ChatGPT and Gemini answers use, so
// an answer reads on the page the way it read on the site: headings, bold,
// lists, tables, links. Pure: text in, a block tree out, no HTML. Anything
// not understood stays visible as plain text; nothing is dropped.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; inlines: Inline[] }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

const INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+`|!?\[[^\]\n]*\]\([^)\s]+\)|\*[^*\s][^*\n]*?\*|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;

/** Bold, italics, inline code, links and bare URLs; everything else is text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (node: Inline) => {
    const last = out[out.length - 1];
    if (node.kind === "text" && last?.kind === "text") last.text += node.text;
    else out.push(node);
  };
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) push({ kind: "bold", children: parseInline(part.slice(2, -2)) });
    else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) push({ kind: "code", text: part.slice(1, -1) });
    else if (/^!?\[/.test(part) && part.endsWith(")")) {
      const match = part.match(/^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (!match) push({ kind: "text", text: part });
      // An image has no place in a text answer; its alt text is kept so nothing vanishes.
      else if (match[1] === "!") push({ kind: "text", text: match[2] ?? "" });
      else if (/^https?:\/\//i.test(match[3]!)) push({ kind: "link", text: match[2] || match[3]!, href: match[3]! });
      else push({ kind: "text", text: match[2] ?? part });
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) push({ kind: "italic", children: parseInline(part.slice(1, -1)) });
    else if (/^https?:\/\//i.test(part)) push({ kind: "link", text: part, href: part });
    else push({ kind: "text", text: part });
  }
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseAnswer(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "") {
      flush();
      continue;
    }
    if (trimmed.startsWith("```")) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        code.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]!.length, inlines: parseInline(heading[2]!) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    if (trimmed.startsWith("|")) {
      flush();
      const table: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        table.push(lines[i]!);
        i += 1;
      }
      i -= 1;
      const rows = table.map(splitRow).filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === ""));
      if (rows.length > 0) {
        blocks.push({ kind: "table", header: rows[0]!.map(parseInline), rows: rows.slice(1).map((cells) => cells.map(parseInline)) });
      }
      continue;
    }
    const item = trimmed.match(/^(?:([-*+•])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      flush();
      const ordered = Boolean(item[2]);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const current = lines[i]!.trim();
        const next = current.match(/^(?:([-*+•])|(\d+)[.)])\s+(.*)$/);
        if (next && Boolean(next[2]) === ordered) {
          items.push(parseInline(next[3]!));
          i += 1;
        } else if (current !== "" && !next && items.length > 0 && /^\s{2,}/.test(lines[i]!)) {
          // An indented continuation line belongs to the item above it.
          items[items.length - 1] = [...items[items.length - 1]!, { kind: "text", text: " " }, ...parseInline(current)];
          i += 1;
        } else break;
      }
      i -= 1;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return blocks;
}

export interface Highlight {
  /** The exact surface the analyzer linked ("TrailStride", "Speedcross 6"). */
  surface: string;
  tone: "target" | "rival" | "untracked";
}

export type TextPiece = { text: string; tone: Highlight["tone"] | null };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits a text run into plain and highlighted pieces. Longest surfaces win,
 * matches are whole words, and case follows the answer, not the surface.
 */
export function splitHighlights(text: string, highlights: Highlight[]): TextPiece[] {
  const surfaces = [...new Map(highlights.filter((h) => h.surface.trim().length > 1).map((h) => [h.surface.toLowerCase(), h])).values()].sort((a, b) => b.surface.length - a.surface.length);
  if (surfaces.length === 0 || text === "") return [{ text, tone: null }];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${surfaces.map((h) => escapeRegex(h.surface)).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const pieces: TextPiece[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    if (start > cursor) pieces.push({ text: text.slice(cursor, start), tone: null });
    const hit = surfaces.find((h) => h.surface.toLowerCase() === match[0].toLowerCase());
    pieces.push({ text: match[0], tone: hit?.tone ?? null });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), tone: null });
  return pieces;
}
