import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingStage } from "@/components/ui/loading-stage";

// The vitest transform keeps the classic JSX runtime (tsconfig "jsx": "preserve").
(globalThis as { React?: typeof React }).React = React;

describe("LoadingStage live region", () => {
  it("is a polite status region that is never aria-busy, so step changes are announced", () => {
    const steps = [
      { key: "connect", label: "Website connected — example.test", state: "done" as const },
      { key: "read", label: "Reading the most useful pages", state: "active" as const },
    ];
    for (const complete of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(LoadingStage, { title: "Analysing", steps, complete }));
      expect(html).toMatch(/^<div role="status" aria-live="polite"/);
      expect(html).not.toContain("aria-busy");
      expect(html).toContain("Reading the most useful pages");
    }
  });
});
