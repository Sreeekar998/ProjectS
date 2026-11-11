// Technical readiness signals, read from the Understand crawl of the
// target's own site. Nothing is fetched here: a signal either exists in the
// stored crawl or it is reported as not recorded.

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { crawlPages, crawlRuns } from "@/lib/db/schema";

export interface ReadinessSummary {
  crawledAt: number;
  robotsAllowed: boolean | null;
  sitemapUrls: number;
  pagesFetched: number;
  pagesSelected: number;
  pagesWithStructuredData: number;
  schemaTypes: string[];
  pagesWithCanonical: number;
  pagesWithHreflang: number;
  usedPlaywrightFallback: boolean;
}

export async function readinessSummary(projectId: string): Promise<ReadinessSummary | null> {
  const db = getDb();
  const crawl = await db.select().from(crawlRuns).where(eq(crawlRuns.projectId, projectId)).orderBy(desc(crawlRuns.startedAt)).get();
  if (!crawl) return null;
  const pages = await db.select().from(crawlPages).where(eq(crawlPages.crawlRunId, crawl.id)).all();
  const fetched = pages.filter((page) => page.httpStatus !== null && page.httpStatus < 400);
  const schemaTypes = new Set<string>();
  let withStructured = 0;
  for (const page of fetched) {
    const types = (page.schemaTypes as string[] | null) ?? [];
    const jsonLd = (page.jsonLd as unknown[] | null) ?? [];
    if (types.length > 0 || jsonLd.length > 0) withStructured += 1;
    for (const type of types) schemaTypes.add(type);
  }
  return {
    crawledAt: new Date(crawl.startedAt).getTime(),
    robotsAllowed: crawl.robotsAllowed ?? null,
    sitemapUrls: ((crawl.sitemapUrls as string[] | null) ?? []).length,
    pagesFetched: fetched.length,
    pagesSelected: fetched.filter((page) => page.isSelected).length,
    pagesWithStructuredData: withStructured,
    schemaTypes: [...schemaTypes].sort(),
    pagesWithCanonical: fetched.filter((page) => Boolean(page.canonicalUrl)).length,
    pagesWithHreflang: fetched.filter((page) => ((page.hreflang as unknown[] | null) ?? []).length > 0).length,
    usedPlaywrightFallback: Boolean(crawl.usedPlaywrightFallback),
  };
}
