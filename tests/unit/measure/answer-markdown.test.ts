import { describe, expect, it } from "vitest";
import { parseAnswer, parseInline, splitHighlights } from "@/lib/measure/answer-markdown";

describe("answer markdown", () => {
  it("reads headings, bold, bullets, numbered lists, links and bare URLs", () => {
    const blocks = parseAnswer("## Top picks\n\n1. **Salomon Speedcross 6** — grip.\n2. **TrailStride Ridge** — light.\n\nSee [Runner's World](https://www.runnersworld.com/gear/x) or https://example.com/a.\n\n- one\n- two");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "list", "paragraph", "list"]);
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
    expect((blocks[1] as { items: unknown[] }).items).toHaveLength(2);
    const paragraph = blocks[2] as { inlines: Array<{ kind: string; href?: string; text?: string }> };
    expect(paragraph.inlines.filter((i) => i.kind === "link").map((i) => i.href)).toEqual(["https://www.runnersworld.com/gear/x", "https://example.com/a"]);
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: false });
  });

  it("reads a table and skips the separator row", () => {
    const [table] = parseAnswer("| Shoe | Price |\n|---|---|\n| Ridge | ₹6,000 |");
    expect(table).toMatchObject({ kind: "table" });
    expect((table as { rows: unknown[][] }).rows).toHaveLength(1);
  });

  it("keeps an image's alt text and never drops unknown syntax", () => {
    expect(parseInline("see ![shoe photo](https://x/y.png) and <b>raw</b>")).toEqual([{ kind: "text", text: "see shoe photo and <b>raw</b>" }]);
  });

  it("highlights whole-word brand surfaces, longest first, case from the answer", () => {
    const pieces = splitHighlights("TrailStride Ridge beats trailstride socks; Salomon too, not Salomonic.", [
      { surface: "TrailStride", tone: "target" },
      { surface: "TrailStride Ridge", tone: "target" },
      { surface: "Salomon", tone: "rival" },
    ]);
    expect(pieces).toEqual([
      { text: "TrailStride Ridge", tone: "target" },
      { text: " beats ", tone: null },
      { text: "trailstride", tone: "target" },
      { text: " socks; ", tone: null },
      { text: "Salomon", tone: "rival" },
      { text: " too, not Salomonic.", tone: null },
    ]);
  });
});
