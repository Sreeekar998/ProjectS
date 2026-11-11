import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPromptSet, listCandidates, updateCandidate, getPromptContextSnapshot } from "@/lib/prompts/repository";
import { getProfileVersion } from "@/lib/profile/repository";
import type { BusinessProfile } from "@/lib/profile/schema";
import { listLocations } from "@/lib/geography/repository";
import { placesToLocations } from "@/lib/prompts/geography";
import { validateCandidate, buildForbiddenBrandTerms, buildCompetitorForbiddenTerms } from "@/lib/prompts/validators";
import type { CandidatePromptDraft } from "@/lib/prompts/types";
import type { PromptContextSnapshotData } from "@/lib/prompts/context";
import { editCustomPrompt, regeneratePromptCandidate, updatePromptSelection } from "@/lib/prompts/orchestrator";
import { withErrorHandling, jsonError } from "@/lib/http/respond";
import { appendEvent } from "@/lib/events/bus";
import { scoreCandidate } from "@/lib/prompts/scoring";
import { textSimilarity } from "@/lib/text/similarity";

const PatchSchema = z.object({
  candidateEdits: z.array(z.object({ id: z.string(), editedText: z.string().min(8).max(300) })).default([]),
  actions: z.array(z.object({ id: z.string(), action: z.enum(["select", "deselect", "reject", "replace", "regenerate"]) })).default([]),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const promptSet = await getPromptSet(id);
    if (!promptSet) return jsonError(404, "prompt_set_not_found", `No prompt set with id ${id}`);
    const candidates = await listCandidates(id);
    return NextResponse.json({ promptSet, candidates });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: promptSetId } = await params;
    const body = PatchSchema.parse(await req.json());
    const promptSet = await getPromptSet(promptSetId);
    if (!promptSet) return jsonError(404, "prompt_set_not_found", `No prompt set with id ${promptSetId}`);
    if (promptSet.status === "approved") return jsonError(409, "prompt_set_already_approved", "This prompt set is frozen and can no longer be edited.");

    const profileVersion = await getProfileVersion(promptSet.businessProfileVersionId);
    if (!profileVersion) return jsonError(404, "profile_not_found", "Underlying business profile version not found.");
    const profile = profileVersion.profile as unknown as BusinessProfile;
    const forbiddenTerms = buildForbiddenBrandTerms(profile);
    const contextSnapshot = promptSet.promptContextSnapshotId ? await getPromptContextSnapshot(promptSet.promptContextSnapshotId) : undefined;
    const context = contextSnapshot?.context as unknown as PromptContextSnapshotData | undefined;
    // Same place list as generation and approval when the snapshot froze one.
    const locations = context?.geography.places ? placesToLocations(promptSet.projectId, context.geography.places) : await listLocations(promptSet.projectId);
    const candidates = await listCandidates(promptSetId);

    const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
    for (const edit of body.candidateEdits) {
      const candidate = candidates.find((c) => c.id === edit.id);
      if (!candidate) {
        results.push({ id: edit.id, ok: false, reason: "candidate_not_found" });
        continue;
      }
      if (candidate.generationSource === "user") {
        // A prompt the reviewer wrote is rechecked by its own rules, which also
        // rebind the competitor it names.
        await editCustomPrompt(promptSetId, candidate.id, edit.editedText);
        results.push({ id: edit.id, ok: true });
        continue;
      }
      const draft: CandidatePromptDraft = {
        text: edit.editedText,
        cohort: candidate.cohort as CandidatePromptDraft["cohort"],
        section: (candidate.section ?? (candidate.cohort === "target_comparison" ? "Trade Offs" : candidate.cohort === "branded_accuracy" ? "Sentiment Analysis" : "Discovery")) as CandidatePromptDraft["section"],
        intent: candidate.intent as CandidatePromptDraft["intent"],
        journeyStage: candidate.journeyStage as CandidatePromptDraft["journeyStage"],
        topicId: candidate.topicId,
        persona: candidate.persona,
        useCaseConstraint: candidate.useCaseConstraint,
        evaluationCriterion: candidate.evaluationCriterion,
        competitorEntityId: candidate.competitorEntityId,
        sentimentTheme: candidate.sentimentTheme,
        geographyScope: candidate.geographyScope as CandidatePromptDraft["geographyScope"],
        geographyText: candidate.geographyText,
        locationId: candidate.locationId,
        language: candidate.language,
        brandPolicy: candidate.brandPolicy as CandidatePromptDraft["brandPolicy"],
        coverageCellKey: candidate.coverageCellKey,
        evidenceBasis: (candidate.evidenceBasis as string[]) ?? [],
        contextBasis: (candidate.contextBasis as string[]) ?? [],
        generationMethod: "template",
      };
      // Edits re-run the same hard gates as generation (spec 5.3 "re-run
      // gates") — a user cannot type the brand name into a neutral slot.
      const validation = validateCandidate(draft, {
        profile,
        forbiddenTerms,
        approvedLocations: locations,
        competitorForbiddenTerms: buildCompetitorForbiddenTerms(context?.confirmedCompetitors ?? []),
        confirmedCompetitors: context?.confirmedCompetitors ?? [],
        approvedTopicIds: context?.confirmedTopics.map((topic) => topic.id) ?? [],
        placeBound: context?.geography.placeBound ?? false,
      });
      if (!validation.pass) {
        results.push({ id: edit.id, ok: false, reason: `${validation.code}: ${validation.reason}` });
        continue;
      }
      const comparable = candidates.filter((other) => other.id !== edit.id && (other.section ?? other.cohort) === (candidate.section ?? candidate.cohort) && ["SHORTLISTED", "SELECTED", "USER_APPROVED"].includes(other.lifecycleState));
      const maxSimilarity = Math.max(0, ...comparable.map((other) => textSimilarity(edit.editedText, other.editedText ?? other.text)));
      if (comparable.some((other) => (other.editedText ?? other.text).trim().toLowerCase() === edit.editedText.trim().toLowerCase())) {
        results.push({ id: edit.id, ok: false, reason: "exact_duplicate: this question already exists in the prompt set" });
        continue;
      }
      const quality = scoreCandidate(draft, maxSimilarity);
      await updateCandidate(edit.id, { editedText: edit.editedText, qualityScore: quality.total, qualityBreakdown: quality as unknown as Record<string, number> });
      results.push({ id: edit.id, ok: true });
      appendEvent(promptSet.projectId, "prompt.candidate.validated", { promptSetId, candidateId: edit.id, edited: true });
    }

    const rejectedEdits = results.filter((r) => !r.ok);
    if (rejectedEdits.length > 0) {
      return jsonError(400, "edit_failed_gates", JSON.stringify(rejectedEdits));
    }

    for (const action of body.actions) {
      if (action.action === "regenerate") await regeneratePromptCandidate(promptSetId, action.id);
      else await updatePromptSelection(promptSetId, action.id, action.action);
    }

    const updatedCandidates = await listCandidates(promptSetId);
    return NextResponse.json({ promptSet, candidates: updatedCandidates, results });
  });
}
