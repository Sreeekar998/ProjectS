import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addCustomPrompt } from "@/lib/prompts/orchestrator";
import { listCandidates } from "@/lib/prompts/repository";
import { withErrorHandling } from "@/lib/http/respond";

const BodySchema = z.object({
  text: z.string().trim().min(8).max(300),
  section: z.enum(["Discovery", "Trade Offs", "Sentiment Analysis"]),
  /** The selected prompt in that section this one takes the place of; required once the section is full. */
  replacesCandidateId: z.string().nullish(),
});

/** Adds a prompt the reviewer wrote to a prompt set that is still under review. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = BodySchema.parse(await req.json());
    const result = await addCustomPrompt(id, body);
    return NextResponse.json({ ...result, candidates: await listCandidates(id) }, { status: 201 });
  });
}
