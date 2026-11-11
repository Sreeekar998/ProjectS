"use client";

// An answer as the site showed it, with the brands the analyzer linked
// highlighted, and its sources as a numbered list with ownership.

import { Fragment, type ReactNode } from "react";
import { parseAnswer, splitHighlights, type Block, type Highlight, type Inline } from "@/lib/measure/answer-markdown";
import type { SourceItem } from "@/lib/measure/answer-evidence";
import { registrableDomainOf } from "./shared";

const TONE_CLASS: Record<Highlight["tone"], string> = {
  target: "rounded bg-sun-100 px-0.5 font-semibold text-sun-900",
  rival: "rounded bg-ink-100 px-0.5 font-medium text-ink-800",
  // <mark> brings the browser's yellow fill; untracked names are outlined
  // only, as the legend under the answer shows.
  untracked: "rounded border border-dashed border-ink-200 bg-transparent px-0.5 text-ink-700",
};

function Text({ text, highlights }: { text: string; highlights: Highlight[] }) {
  return (
    <>
      {splitHighlights(text, highlights).map((piece, index) =>
        piece.tone ? (
          <mark key={index} className={TONE_CLASS[piece.tone]}>
            {piece.text}
          </mark>
        ) : (
          <Fragment key={index}>{piece.text}</Fragment>
        ),
      )}
    </>
  );
}

function Inlines({ inlines, highlights }: { inlines: Inline[]; highlights: Highlight[] }) {
  return (
    <>
      {inlines.map((node, index) => {
        switch (node.kind) {
          case "text":
            return <Text key={index} text={node.text} highlights={highlights} />;
          case "bold":
            return (
              <strong key={index} className="font-semibold text-ink-900">
                <Inlines inlines={node.children} highlights={highlights} />
              </strong>
            );
          case "italic":
            return (
              <em key={index}>
                <Inlines inlines={node.children} highlights={highlights} />
              </em>
            );
          case "code":
            return (
              <code key={index} className="rounded bg-ink-50 px-1 font-mono text-[12px]">
                {node.text}
              </code>
            );
          case "link":
            return (
              <a key={index} href={node.href} target="_blank" rel="noreferrer" className="text-brand-600 underline decoration-brand-600/40 hover:decoration-brand-600">
                <Text text={node.text} highlights={highlights} />
              </a>
            );
        }
      })}
    </>
  );
}

function BlockView({ block, highlights }: { block: Block; highlights: Highlight[] }) {
  switch (block.kind) {
    case "heading": {
      const className = block.level <= 2 ? "mt-3 text-base font-semibold text-ink-900" : "mt-2 text-sm font-semibold text-ink-900";
      return (
        <p className={className}>
          <Inlines inlines={block.inlines} highlights={highlights} />
        </p>
      );
    }
    case "paragraph":
      return (
        <p>
          <Inlines inlines={block.inlines} highlights={highlights} />
        </p>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <Inlines inlines={item} highlights={highlights} />
        </li>
      ));
      return block.ordered ? <ol className="list-decimal space-y-1 pl-5">{items}</ol> : <ul className="list-disc space-y-1 pl-5">{items}</ul>;
    }
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-ink-100 text-left">
                {block.header.map((cell, index) => (
                  <th key={index} className="py-1 pr-3 font-semibold text-ink-800">
                    <Inlines inlines={cell} highlights={highlights} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="py-1 pr-3 align-top">
                      <Inlines inlines={cell} highlights={highlights} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return <pre className="overflow-x-auto rounded-lg bg-ink-50 p-2 font-mono text-[12px]">{block.text}</pre>;
    case "rule":
      return <hr className="border-ink-100" />;
  }
}

/** The answer text as the site showed it, with linked brands highlighted. */
export function AnswerText({ text, highlights = [] }: { text: string; highlights?: Highlight[] }) {
  return (
    <div className="space-y-2.5 text-sm leading-6 text-ink-700">
      {parseAnswer(text).map((block, index) => (
        <BlockView key={index} block={block} highlights={highlights} />
      ))}
    </div>
  );
}

export type { SourceItem } from "@/lib/measure/answer-evidence";

/** Sources as the page listed them, numbered, with who owns each domain. */
export function SourceList({ sources, brand, footer }: { sources: SourceItem[]; brand: string; footer?: ReactNode }) {
  return (
    <ol className="mt-1 space-y-1">
      {sources.map((source, index) => {
        const domain = registrableDomainOf(source.url);
        const tone = source.ownership === "TARGET_OWNED" ? "bg-sun-100 text-sun-800" : source.ownership === "COMPETITOR_OWNED" ? "bg-ink-100 text-ink-700" : "bg-white text-ink-500 border border-dashed border-ink-200";
        const label = source.ownership === "TARGET_OWNED" ? `${brand}` : source.ownership === "COMPETITOR_OWNED" ? (source.ownerName ?? "rival") : "third party";
        return (
          <li key={`${source.url}-${index}`} className="flex items-start gap-2 text-xs">
            <span className="w-5 shrink-0 text-right tabular-nums text-ink-400">{index + 1}.</span>
            <span className="min-w-0 flex-1">
              <a href={source.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-[11px] text-brand-600 hover:underline" title={source.url}>
                {domain}
                <span className="text-ink-400">{source.url.replace(/^https?:\/\/(www\.)?[^/]+/i, "").replace(/\?utm_source=chatgpt\.com$/i, "") || "/"}</span>
              </a>
            </span>
            <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${tone}`}>{label}</span>
          </li>
        );
      })}
      {footer}
    </ol>
  );
}
