import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Operators asked for no confidence levels and no rejected items or reasons in
// the app (feedback 2026-09-14). This guard fails when that copy comes back in
// a stage page or feature component. Comments are ignored so a code comment can
// still name the incident behind a rule.

const ROOT = path.resolve(__dirname, "../../..");
const SCANNED = ["src/app/projects", "src/components/features"];
const FORBIDDEN = /High confidence|Medium confidence|Low confidence|Needs review|Ruled out|not suggested|Confirm anyway|% match|unsupported finding|notes from the analysis/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Drops block comments, JSX comments and whole-line `//` comments, keeping line numbers. */
function withoutComments(source: string): string {
  const blanked = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  return blanked
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

describe("UI copy guard: no confidence levels, no rejected items", () => {
  it("finds none of the removed phrases in stage pages or feature components", () => {
    const hits: string[] = [];
    for (const dir of SCANNED) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        withoutComments(fs.readFileSync(file, "utf8"))
          .split("\n")
          .forEach((line, index) => {
            const match = line.match(FORBIDDEN);
            if (match) hits.push(`${path.relative(ROOT, file)}:${index + 1}: ${match[0]}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });

  it("names no collection vendor anywhere in the app", () => {
    // The reader sees ChatGPT and Gemini, never the infrastructure behind an
    // answer (feedback 2026-09-16, repeated). No page, component or export
    // names a vendor; keys come from .env.local or the credentials API.
    const APP = ["src/app", "src/components", "src/lib/measure"];
    const files = APP.flatMap((dir) => sourceFiles(path.join(ROOT, dir))).filter((file) => !file.includes("/api/"));
    // Vendor names, and the phrases that reveal there is a vendor at all.
    const VENDOR = /oxylabs|cloro|bright ?data|decodo|collection provider|collection access|settings\/collection/i;
    const hits: string[] = [];
    for (const file of files) {
      withoutComments(fs.readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, index) => {
          const match = line.match(VENDOR);
          if (match) hits.push(`${path.relative(ROOT, file)}:${index + 1}: ${match[0]}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("strips comments without hiding code", () => {
    const source = ['const a = "keep";', "// Ruled out: comment", "/* Needs review */ const b = 1;", "{/* Low confidence */}"].join("\n");
    const stripped = withoutComments(source);
    expect(stripped).toContain('const a = "keep";');
    expect(stripped).toContain("const b = 1;");
    expect(stripped).not.toMatch(FORBIDDEN);
    expect('<Badge>High confidence</Badge>').toMatch(FORBIDDEN);
  });
});
