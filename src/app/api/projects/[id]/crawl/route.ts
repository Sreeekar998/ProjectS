import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProject } from "@/lib/projects/repository";
import { crawlJobKey, crawlStartSequence, noteCrawlStart, previousRunRequestedSearchConsole, runCrawlAndProfilePipeline } from "@/lib/crawler/pipeline";
import { latestSequence } from "@/lib/events/bus";
import { tryAcquire } from "@/lib/jobs/active";
import { withErrorHandling, jsonError } from "@/lib/http/respond";
import { appOrigin } from "@/lib/search-console/config";

// The body is optional: scripts, the e2e journey and "Analyse again" post none.
const CrawlBodySchema = z.object({
  searchConsole: z.object({ enabled: z.boolean() }).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return jsonError(404, "project_not_found", `No project with id ${id}`);

    // Read as text: `req.json()` on an empty body throws, and a malformed body
    // used to surface as a redacted 500.
    const text = await req.text();
    let body: z.infer<typeof CrawlBodySchema> = {};
    if (text.trim()) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return jsonError(400, "invalid_request", "The request body is not valid JSON.");
      }
      const parsed = CrawlBodySchema.safeParse(json);
      if (!parsed.success) {
        return jsonError(400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      }
      body = parsed.data;
    }

    // Search Console reads the operator's private data with a server-side token,
    // so only this app's own address may turn it on (see appOrigin): a
    // DNS-rebinding page could otherwise start a pull, including by a bodiless
    // retry that inherits the previous run's choice. With it off, any host works.
    const trustedHost = appOrigin(req) !== null;
    const searchConsole = body.searchConsole ?? (trustedHost ? undefined : { enabled: await previousRunRequestedSearchConsole(project.id) });
    if (searchConsole?.enabled && !trustedHost) {
      return jsonError(403, "untrusted_host", "Search Console can only be used from this app's own address (localhost, or the host in GOOGLE_OAUTH_REDIRECT_URI).");
    }

    // One crawl per project at a time: a second click used to start a second
    // crawl whose events leaked into the first one's progress rail.
    const sinceSequence = latestSequence(project.id);
    if (!tryAcquire(crawlJobKey(project.id))) {
      return NextResponse.json({ status: "already_running", sinceSequence: crawlStartSequence(project.id) ?? sinceSequence }, { status: 202 });
    }
    noteCrawlStart(project.id, sinceSequence);

    // Fire-and-forget: the client should already be listening on
    // /api/projects/:id/events before or immediately after calling this, so
    // it catches crawl.started (which carries the crawlRunId) and every
    // subsequent step. See spec 10.2 — no long-running stage may block here.
    // The pipeline releases the job key when it ends.
    void runCrawlAndProfilePipeline(project.id, searchConsole ? { searchConsole } : {});

    return NextResponse.json({ status: "started", sinceSequence }, { status: 202 });
  });
}
