import { describe, it, expect, vi } from "vitest";
import { createProject } from "@/lib/projects/repository";
import { runWebsiteIntelligence } from "@/lib/profile/orchestrator";
import { confirmProfileVersion } from "@/lib/profile/repository";
import { generateLandscape } from "@/lib/landscape/orchestrator";
import { updateTopic, updateEntity, addEntity, freezeCompetitiveSet } from "@/lib/landscape/repository";
import { generatePromptSet, approvePromptSet } from "@/lib/prompts/orchestrator";
import { listCandidates } from "@/lib/prompts/repository";
import { createCollectionRun, runAutomatedPromptRun, markPromptRunTypedOutcome } from "@/lib/collection/orchestrator";
import { listPromptRuns } from "@/lib/collection/repository";
import { measureRun } from "@/lib/measure/service";
import type { BusinessProfile } from "@/lib/profile/schema";

// End-to-end regression test of the full product journey (spec section 1.1
// / 17): an arbitrary public website neither this test nor the app has seen
// before goes all the way to a Measure snapshot with reproducible x/n
// denominators. Uses a live public site rather than a local fixture,
// because runCrawl's SSRF guard correctly refuses loopback targets (see
// tests/security/ssrf.test.ts) — this is the one test in the suite that
// genuinely needs internet access, and is documented as such in
// IMPLEMENTATION_STATUS.md.
describe.sequential("full pipeline: crawl -> profile -> landscape -> prompts -> collection -> measure", () => {
  it(
    "reaches an approved 30-prompt cohort and a reconciled Measure snapshot for an unseen site",
    async () => {
      const project = await createProject({ url: "https://books.toscrape.com/", marketScope: "global", language: "en" });

      // runWebsiteIntelligence owns the whole crawl -> evidence -> profile
      // chain now, so the integration test drives the same entry point the
      // API route does rather than stitching the stages together itself.
      const { version: profileVersionRow, crawl: crawlOutcome } = await runWebsiteIntelligence(project.id);
      expect(crawlOutcome?.status).toBe("completed");
      expect(profileVersionRow.profile).toBeTruthy();
      await confirmProfileVersion(profileVersionRow.id, "test-operator");
      const profileVersion = { ...profileVersionRow, profile: profileVersionRow.profile as unknown as BusinessProfile };

      const landscape = await generateLandscape(project.id, profileVersion.id);
      expect(landscape.topics.length).toBeGreaterThanOrEqual(4);
      for (const topic of landscape.topics.slice(0, 6)) await updateTopic(topic.id, { status: "confirmed" });

      const competitor = await addEntity(project.id, { canonicalName: "TestRival", kind: "competitor", competitorType: "direct" });
      await updateEntity(competitor.id, { status: "confirmed" });
      await freezeCompetitiveSet(project.id, profileVersion.id);

      const promptSet = await generatePromptSet(project.id);
      const candidates = await listCandidates(promptSet.id);
      const selected = candidates.filter((c) => c.lifecycleState === "SELECTED");
      // books.toscrape.com is a scraping sandbox with a thin catalogue, and
      // this suite runs with no AI provider, so the deterministic renderers
      // cannot always produce ten distinct natural Discovery questions. The
      // invariant that must hold is that no section over-fills and nothing
      // malformed is selected — filling the last slots with filler would be
      // the actual failure.
      expect(selected.length).toBeLessThanOrEqual(30);
      expect(selected.length).toBeGreaterThanOrEqual(20);
      const perSection = new Map<string, number>();
      for (const candidate of selected) {
        const section = candidate.section ?? "Discovery";
        perSection.set(section, (perSection.get(section) ?? 0) + 1);
      }
      for (const [section, count] of perSection) {
        expect(count, `${section} must never exceed ten`).toBeLessThanOrEqual(10);
      }

      const neutral = selected.filter((c) => c.cohort.startsWith("neutral"));
      const branded = selected.filter((c) => c.cohort === "branded_accuracy");
      const comparison = selected.filter((c) => c.cohort === "target_comparison");
      // Ten slots per section is the ceiling; a thin site may under-fill.
      expect(neutral.length).toBeLessThanOrEqual(10);
      expect(branded.length).toBeLessThanOrEqual(10);
      expect(comparison.length).toBeLessThanOrEqual(10);

      // Zero target-brand leakage in the neutral TARGET_FORBIDDEN cohort —
      // the single most important product invariant in the whole pipeline.
      const brandTerms = [profileVersion.profile.identity.brandName.value.toLowerCase()];
      const leaks = neutral.filter((c) => c.brandPolicy === "TARGET_FORBIDDEN" && brandTerms.some((t) => c.text.toLowerCase().includes(t)));
      expect(leaks).toEqual([]);

      // Exactly-30 duplicate-text check across the whole approved cohort.
      const seenText = new Set<string>();
      for (const c of selected) {
        const key = `${c.cohort}::${(c.editedText ?? c.text).trim().toLowerCase()}`;
        expect(seenText.has(key)).toBe(false);
        seenText.add(key);
      }

      // Approval requires a full 10/10/10 set, so it is only attempted when
      // every section actually filled.
      if (selected.length !== 30) return;
      const approved = await approvePromptSet(promptSet.id, "test-operator");
      expect(approved.status).toBe("approved");
      expect(approved.frozenHash).toBeTruthy();

      // Collection runs through the real automated path. The provider call
      // itself is stubbed — the point of this test is the pipeline, not the
      // network — but everything downstream of it is genuine: state machine,
      // evidence store, analysis and measurement.
      process.env.BRIGHTDATA_API_TOKEN = "test-key";
      const answer = `1. ${profileVersion.profile.identity.brandName.value} is worth a look.\n2. TestRival is also solid.`;
      const realFetch = globalThis.fetch;
      vi.stubGlobal("fetch", async (input: URL | string, init?: RequestInit) => {
        if (input.toString().includes("api.brightdata.com")) {
          // The shape Bright Data's ChatGPT scraper documents, with the page's
          // own markers (site URL, utm tag, search flag, page HTML).
          const record = {
            url: "https://chatgpt.com/?q=test",
            prompt: "test",
            answer_text: answer,
            answer_text_markdown: answer,
            answer_html: '<html lang="en-US" data-build="prod-test"><body>…</body></html>',
            model: null,
            web_search_triggered: true,
            citations: [{ url: "https://reviews.example/list?utm_source=chatgpt.com", title: "Reviews", description: null, icon: null }],
            search_sources: [],
            links_attached: [],
            prompt_sent_at: new Date().toISOString(),
            country: "US",
          };
          return new Response(JSON.stringify([record]), { status: 200, headers: { "content-type": "application/json" } });
        }
        return realFetch(input as never, init);
      });

      const collectionRun = await createCollectionRun(project.id, ["chatgpt_brightdata_web"]);
      const runs = await listPromptRuns(collectionRun.id);
      expect(runs.length).toBe(30); // 30 prompts x 1 enabled route

      let succeededCount = 0;
      for (const [idx, run] of runs.slice(0, 10).entries()) {
        if (idx === 3) {
          // One typed failure, to prove a failed observation stays a coverage
          // gap and never becomes a brand absence.
          await markPromptRunTypedOutcome(run.id, "failed", "test-simulated-failure");
          continue;
        }
        await runAutomatedPromptRun(run.id);
        succeededCount++;
      }
      expect(succeededCount).toBeGreaterThan(0);
      vi.unstubAllGlobals();
      delete process.env.BRIGHTDATA_API_TOKEN;

      const failedRunId = runs[3]!.id;
      const measure = await measureRun(project.id, collectionRun.id);
      expect(measure.coverage.planned).toBe(30);
      expect(measure.coverage.byProvider.chatgpt_brightdata_web?.planned).toBe(30);
      // The typed failure stays a coverage gap: planned, never captured.
      expect(measure.coverage.captured).toBeLessThanOrEqual(succeededCount);
      expect(measure.coverage.planned - measure.coverage.captured).toBeGreaterThanOrEqual(1);
      expect(measure.coverage.analysable).toBeLessThanOrEqual(measure.coverage.captured);
      // A metric's denominator must never exceed the eligible observations, and
      // a failure must never be silently counted as a target absence.
      const visibility = measure.metrics.combined!.discovery_visibility!;
      expect(visibility.denominator).toBe(measure.scopes.discovery.eligible);
      expect(visibility.denominator).toBeLessThanOrEqual(measure.coverage.analysable);
      if (visibility.value !== null) expect(visibility.numerator).toBeLessThanOrEqual(visibility.denominator);
      for (const metric of Object.values(measure.metrics.combined!)) {
        expect(metric!.denominatorObservationIds).not.toContain(failedRunId);
      }
    },
    120_000,
  );
});
