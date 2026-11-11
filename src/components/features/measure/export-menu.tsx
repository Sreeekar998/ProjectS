"use client";

// The one Export control for a measurement: the report and the answers as
// pages, the question table and the full measurement as files, and print.
//
// Files download through `downloadFile` so a failed export shows its message
// here instead of replacing the workspace with a JSON error page, and the menu
// closes itself after a choice (a <details> menu with <a> children stayed open
// after a download because no navigation happened).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Spinner } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { downloadFile, DownloadError } from "@/lib/client/download";
import { cn } from "@/lib/cn";

export type ExportFormat = "csv" | "json" | "brands-csv" | "sources-csv";

const FILE_LABEL: Record<ExportFormat, string> = {
  csv: "Question table (CSV)",
  json: "Full measurement (JSON)",
  "brands-csv": "Brands table (CSV)",
  "sources-csv": "Sources table (CSV)",
};

export function ExportMenu({ projectId, runId, href, className = "", variant = "menu" }: { projectId: string; runId: string; href: (view: string) => string; className?: string; variant?: "menu" | "row" }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const details = useRef<HTMLDetailsElement>(null);

  // A success note fades by itself; an error stays until the next attempt.
  useEffect(() => {
    if (!message || message.tone !== "ok") return;
    const timer = setTimeout(() => setMessage(null), 4_000);
    return () => clearTimeout(timer);
  }, [message]);

  // Close on a click outside or Escape, like a menu should.
  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (details.current?.open && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.current?.open) details.current.open = false;
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function save(format: ExportFormat) {
    setBusy(format);
    setMessage(null);
    try {
      const name = await downloadFile(api.measureExportUrl(projectId, runId, format), `measure.${format.endsWith("csv") ? "csv" : "json"}`);
      setMessage({ tone: "ok", text: `Saved ${name}.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof DownloadError ? error.message : "The file could not be saved. Try again." });
    } finally {
      setBusy(null);
      if (details.current) details.current.open = false;
    }
  }

  const fileButton = (format: ExportFormat, itemClass: string) => (
    <button key={format} type="button" onClick={() => void save(format)} disabled={busy !== null} className={itemClass}>
      {busy === format ? (
        <span className="inline-flex items-center gap-2">
          <Spinner /> Preparing…
        </span>
      ) : (
        FILE_LABEL[format]
      )}
    </button>
  );

  if (variant === "row") {
    const item = "focus-ring rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-sheet hover:border-ink-300 hover:bg-paper disabled:opacity-60";
    return (
      <div className={className}>
        <div className="flex flex-wrap gap-2">
          <Link href={href("report")} className={item}>The report (print or save as PDF)</Link>
          <Link href={href("answers")} className={item}>Every answer, in full</Link>
          {(["csv", "brands-csv", "sources-csv", "json"] as ExportFormat[]).map((format) => fileButton(format, item))}
        </div>
        {message && (
          <p role="status" className={cn("mt-2 text-xs", message.tone === "error" ? "text-danger-600" : "text-ok-600")}>
            {message.text}
          </p>
        )}
      </div>
    );
  }

  const item = "focus-ring block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-800 hover:bg-paper disabled:opacity-60";
  return (
    <div className={cn("relative", className)}>
      <details ref={details} className="relative">
        <summary
          aria-haspopup="menu"
          className="focus-ring inline-flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-900 shadow-sheet hover:border-ink-300 hover:bg-paper"
        >
          Export
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-ink-400">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
          </svg>
        </summary>
        <div role="menu" className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-ink-200/75 bg-white p-1 shadow-float">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Pages</p>
          <Link href={href("report")} role="menuitem" className={item}>The report (print or PDF)</Link>
          <Link href={href("answers")} role="menuitem" className={item}>Every answer, in full</Link>
          <button type="button" role="menuitem" onClick={() => window.print()} className={item}>Print this view</button>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Files</p>
          {(["csv", "brands-csv", "sources-csv", "json"] as ExportFormat[]).map((format) => fileButton(format, item))}
        </div>
      </details>
      {message && (
        <p role="status" className={cn("absolute right-0 top-full mt-1 w-64 rounded-lg border bg-white px-3 py-2 text-xs shadow-float", message.tone === "error" ? "border-danger-500/30 text-danger-600" : "border-ok-500/30 text-ok-600")}>
          {message.text}
        </p>
      )}
    </div>
  );
}
