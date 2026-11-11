import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createProject, listProjects, type Project } from "@/lib/projects/repository";
import { buildMarketHint, MarketHintInputSchema, parseMarketHint } from "@/lib/projects/market-hint";
import { withErrorHandling } from "@/lib/http/respond";

// Non-strict on purpose: zod drops unknown keys, so an older or newer client
// sending an extra field (the Search Console choice once rode here) still
// creates the project. Search Console now travels in the crawl request body.
const CreateProjectSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  /** "Where are your customers?" from the intake page. Null or absent = detect from the website. */
  market: MarketHintInputSchema.nullable().optional(),
  /** Legacy (scripts, tests): ISO alpha-2 → country hint; "global" or anything else → no hint. Ignored when `market` is present. */
  marketScope: z.string().max(40).optional(),
  language: z.string().min(1).default("en"),
});

/** The row plus the parsed hint, so clients never parse `marketScope` themselves. */
function withMarket(project: Project) {
  return { ...project, market: parseMarketHint(project.marketScope) };
}

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const body = CreateProjectSchema.parse(await req.json());
    const marketGiven = body.market !== undefined;
    const project = await createProject({
      url: body.url,
      marketHint: marketGiven ? (body.market ? buildMarketHint(body.market) : null) : undefined,
      marketScope: marketGiven ? undefined : body.marketScope,
      language: body.language,
    });
    return NextResponse.json({ project: withMarket(project) }, { status: 201 });
  });
}

export async function GET() {
  return withErrorHandling(async () => {
    const projects = await listProjects();
    return NextResponse.json({ projects: projects.map(withMarket) });
  });
}
