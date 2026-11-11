"use client";

import type { JSX } from "react";
import { FieldShell } from "@/components/features/profile-fields";
import type { SunEventPayload } from "@/lib/client/use-project-events";
import type { SearchConsoleProfileSummary } from "@/lib/search-console/types";
import { searchDemandView } from "@/lib/search-console/view";

// Understand-page "Search demand" section, rendered after the Location card once
// analysis is complete (feedback 2026-09-14: nothing before 100%).
//
// It renders only from the saved `profile.searchConsole` summary plus the last
// `search_console.sync.*` event of the cycle, so a reload shows the same thing.
// No confidence labels, no badges, and no ambiguous or unmatched query lists
// (feedback: don't show rejected items). When Search Console wasn't used it is
// a single plain line saying why; when it was never switched on, nothing.
// Query text is customer language from Google and is rendered as plain text.

export interface SearchDemandCardProps {
  summary?: SearchConsoleProfileSummary;
  lastSyncEvent: SunEventPayload | null;
}

export function SearchDemandCard(props: SearchDemandCardProps): JSX.Element | null {
  const view = searchDemandView(props.summary, props.lastSyncEvent);
  if (view.kind === "hidden") return null;

  if (view.kind === "notice") {
    return (
      <FieldShell label="Search demand">
        <p className="text-sm text-ink-500">{view.message}</p>
      </FieldShell>
    );
  }

  return (
    <FieldShell label="Search demand">
      <p className="text-xs text-ink-400">
        Google Search Console · <span className="break-all">{view.property}</span> · {view.period}
      </p>
      <p className="mt-1.5 text-sm font-medium text-ink-900">{view.headline}</p>
      {view.notUsed ? (
        <p className="mt-1 text-sm text-ink-500">{view.notUsed}</p>
      ) : (
        <>
          {view.searches.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-ink-500">What people search without your name</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {view.searches.map((query) => (
                  <li key={query} className="max-w-full truncate rounded-full border border-ink-200 bg-paper px-2.5 py-0.5 text-xs text-ink-700">
                    {query}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {view.countries && (
            <p className="mt-3 text-xs text-ink-500">
              Where searches come from: <span className="text-ink-700">{view.countries}</span>
            </p>
          )}
          {view.notes.map((note) => (
            <p key={note} className="mt-2 text-xs text-ink-400">
              {note}
            </p>
          ))}
          <p className="mt-2 text-xs text-ink-400">{view.usedFor}</p>
        </>
      )}
      <p className="mt-2 text-xs text-ink-400">{view.footnote}</p>
    </FieldShell>
  );
}
