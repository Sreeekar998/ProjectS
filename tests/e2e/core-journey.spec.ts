import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Drives the real browser through marketing -> trial intake -> crawl
// progress -> profile confirmation -> landscape confirmation, against a
// real crawl of a live public site (see IMPLEMENTATION_STATUS.md — this is
// the one live-network-dependent test in the suite, mirroring
// tests/integration/full-pipeline.test.ts but from the UI side).
//
// Run with paid routes off: `SUN_LLM_NO_PAID=1 OPENAI_API_KEY= npm run test:e2e`.
// The Playwright dev server loads .env.local, which holds a paid OpenAI key.
test.describe.configure({ mode: "serial" });

/** Creates a project with a confirmed manual profile, so Landscape and Prompts can open without a crawl. */
async function manualProject(request: APIRequestContext, slug: string) {
  const created = await request.post("/api/projects", { data: { url: `https://${slug}-${Date.now()}.example`, marketScope: "US", language: "en" } });
  expect(created.ok()).toBe(true);
  const { project } = await created.json();
  const profile = await request.post(`/api/projects/${project.id}/profile/manual`, {
    data: {
      brandName: "Northstar Flow",
      archetype: "b2b_saas_enterprise",
      industry: "workflow automation software",
      description: "Workflow automation for operations and finance teams.",
      offerings: ["workflow automation", "approval routing"],
      customerJobs: ["automate approval routing", "reduce manual handoffs"],
      personas: ["operations teams", "finance leaders"],
      decisionConstraints: ["implementation effort", "integration needs", "reporting"],
      countries: ["United States"],
      regulated: false,
    },
  });
  expect(profile.ok()).toBe(true);
  return project as { id: string };
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

/** A place-search suggestion in the /api/geo/search response shape (no live geocoder). */
const AREA_FIXTURE = {
  id: "fixture:difc",
  title: "DIFC",
  subtitle: "Dubai, United Arab Emirates",
  level: "neighborhood",
  place: {
    label: "DIFC, Dubai, United Arab Emirates",
    formattedAddress: null,
    premise: null,
    street: null,
    neighborhood: "DIFC",
    district: null,
    city: "Dubai",
    region: "Dubai",
    country: "United Arab Emirates",
    countryCode: "AE",
    postalCode: null,
    lat: 25.2116,
    lng: 55.2796,
    precision: "neighborhood",
    provider: "photon",
    providerId: "fixture-difc",
    confidence: 80,
    evidenceIds: [],
  },
};

test("marketing page explains AI visibility and starts from a website", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /know where your brand stands in ai answers/i })).toBeVisible();
  await expect(page.locator("#hero-website")).toBeVisible();
  await page.locator("#hero-website").fill("example.com");
  await page.getByRole("button", { name: /analyze my brand/i }).first().click();
  await expect(page).toHaveURL(/\/trial\/new\?url=example.com/);
  // The URL must survive the hand-off: the user never types it twice.
  await expect(page.locator("#url")).toHaveValue("example.com");
  // It is pre-filled, not submitted: the market and Search Console choices
  // come next, so the page stays on intake with the market field focused.
  await expect(page.locator("#market-country")).toBeFocused();
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/trial\/new\?url=example.com/);
});

test("the Start free analysis CTA reaches the analysis workflow with the field focused", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /start free analysis/i }).first().click();
  await expect(page).toHaveURL(/\/trial\/new$/);
  await expect(page.locator("#url")).toBeFocused();
  await expect(page.locator("#url")).toHaveValue("");
});

test("both landing CTAs lead into the same analysis route", async ({ page }) => {
  await page.goto("/");
  const navCta = page.getByRole("link", { name: /start free analysis/i }).first();
  await expect(navCta).toHaveAttribute("href", "/trial/new");

  // The final call-to-action section carries the same form as the hero.
  await page.locator("#final-website").fill("example.org");
  await page.getByRole("button", { name: /analyze my brand/i }).nth(1).click();
  await expect(page).toHaveURL(/\/trial\/new\?url=example.org/);
});

test("full journey: analysis through landscape confirmation", async ({ page }) => {
  // Results appear only when each stage completes: crawl, understanding and
  // landscape generation together take longer than the default 60 s.
  test.setTimeout(300_000);
  // Enter through the landing page exactly as a user would, so the CTA
  // hand-off is part of the journey rather than a separately-tested detail.
  await page.goto("/");
  await page.locator("#hero-website").fill("https://books.toscrape.com/");
  await page.getByRole("button", { name: /analyze my brand/i }).first().click();
  await expect(page).toHaveURL(/\/trial\/new\?url=/);
  await page.getByRole("button", { name: "Analyse my brand" }).click();

  await expect(page).toHaveURL(/\/projects\/.+\/understand/, { timeout: 30_000 });

  // The analysis narrates itself rather than showing a single blocking spinner.
  await expect(page.getByRole("status").getByText(/^Understanding /).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/website connected/i)).toBeVisible({ timeout: 20_000 });
  // Nothing from the unfinished profile is shown while progress runs.
  await expect(page.getByText("BRAND NAME")).toHaveCount(0);

  // Fields appear once the analysis is complete.
  await expect(page.getByText("BRAND NAME")).toBeVisible({ timeout: 180_000 });
  // The progress rail is gone when results show.
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByText("DESCRIPTION")).toBeVisible();
  // Profiles with Business Understanding show "Business type" and "Location";
  // rules-only profiles (no model key) keep "Industry" and "Target market".
  await expect(page.getByText(/^(industry|business type)$/i).first()).toBeVisible();
  await expect(page.getByText("PRODUCTS & SERVICES")).toBeVisible();
  await expect(page.getByText(/^(target market|location)$/i).first()).toBeVisible();
  await expect(page.getByText("BRAND IDENTITY")).toBeVisible();
  // No confidence levels and no rejected findings on the results.
  await expect(page.getByText(/high confidence|medium confidence|low confidence|needs review|ruled out|unsupported finding|notes from the analysis/i)).toHaveCount(0);

  // Evidence is inspectable rather than asserted.
  await page.getByRole("button", { name: "Why?" }).first().click();
  await expect(page.getByRole("button", { name: "Why?" }).first()).toHaveAttribute("aria-expanded", "true");

  const confirmProfile = page.getByRole("button", { name: "Confirm profile" });
  await expect(confirmProfile).toBeEnabled({ timeout: 60_000 });
  await confirmProfile.click();
  await expect(page).toHaveURL(/\/projects\/.+\/landscape/, { timeout: 30_000 });

  // Topics and competitors appear when generation completes; a loading panel shows until then.
  await expect(page.getByRole("heading", { name: "Topics & competitors" })).toBeVisible();
  await expect(page.getByRole("status").first()).toBeVisible();
  await expect(page.getByText("Topics", { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/not suggested|confirm anyway|% match/i)).toHaveCount(0);
  const confirmButtons = page.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirmButtons.first()).toBeVisible({ timeout: 15_000 });
  const count = await confirmButtons.count();
  for (let i = 0; i < Math.min(count, 6); i++) {
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
    await page.waitForTimeout(200); // sequential, not concurrent — avoids the client-side race documented in IMPLEMENTATION_STATUS.md
  }

  await expect(page.getByText(/confirmed$/).first()).toBeVisible();
});

test("refreshing mid-analysis keeps showing progress only", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/trial/new?url=https://books.toscrape.com/&start=1");
  await expect(page).toHaveURL(/\/projects\/.+\/understand/, { timeout: 30_000 });
  await expect(page.getByText(/website connected/i)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByRole("status").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("BRAND NAME")).toHaveCount(0);
  await expect(page.getByText("BRAND NAME")).toBeVisible({ timeout: 180_000 });
});

test("profile edits persist across a page refresh", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/trial/new?url=https://books.toscrape.com/&start=1");
  await expect(page).toHaveURL(/\/projects\/.+\/understand/, { timeout: 30_000 });

  const editButton = page.getByRole("button", { name: "Edit profile" });
  await expect(editButton).toBeEnabled({ timeout: 180_000 });
  await editButton.click();

  const edited = "An edited description that must survive a refresh.";
  await page.getByLabel("Description").fill(edited);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/saved as a new version/i)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByText(edited)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Edited by you").first()).toBeVisible();
});

test("an unreachable website reports a failure instead of a fabricated profile", async ({ page }) => {
  await page.goto("/trial/new?url=https://this-domain-should-not-resolve-project-sun.invalid&start=1");
  // Either the intake rejects it, or the analysis page reports the failure —
  // both are honest outcomes; silently inventing a profile is not.
  await expect(
    page.getByText(/not a valid url|could not|resolve/i).first(),
  ).toBeVisible({ timeout: 45_000 });
});

test("desktop and mobile viewports render the analysis form without clipping", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/trial/new");
  await expect(page.locator("#url")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("#url")).toBeVisible();
  const box = await page.locator("#url").boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);
});

test("market location on intake: all countries, an area for one country, sent with the project", async ({ page, request }) => {
  const projectPosts: Array<Record<string, any>> = [];
  let createdId: string | null = null;
  await page.route("**/api/geo/search**", (route) => route.fulfill({ json: { suggestions: [AREA_FIXTURE], provider: "openstreetmap" } }));
  await page.route("**/api/geo/place", (route) => route.fulfill({ json: { place: AREA_FIXTURE.place } }));
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    projectPosts.push(route.request().postDataJSON());
    const response = await route.fetch();
    const body = await response.json();
    createdId = body?.project?.id ?? null;
    await route.fulfill({ response, json: body });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trial/new");
  await page.locator("#url").fill(`https://market-intake-${Date.now()}.invalid`);
  const country = page.locator("#market-country");
  const countries = page.getByRole("listbox", { name: "Countries" });

  // Every ISO country plus Detect and Worldwide.
  await country.click();
  await expect(countries).toBeVisible();
  expect(await countries.getByRole("option").count()).toBeGreaterThanOrEqual(252);
  await noHorizontalOverflow(page);
  await country.press("Escape");

  // Diacritics and aliases are searchable.
  await country.fill("cote");
  await expect(countries.getByRole("option", { name: /C[ôo]te d.Ivoire/ })).toBeVisible();
  await country.fill("kosovo");
  await expect(countries.getByRole("option", { name: /Kosovo/ })).toBeVisible();

  // Worldwide has no area.
  await country.fill("worldwide");
  await countries.getByRole("option", { name: /Worldwide/ }).click();
  await expect(page.locator("#market-area")).toHaveCount(0);

  // Keyboard only: type, arrow, enter.
  await country.fill("united ar");
  await country.press("ArrowDown");
  await country.press("Enter");
  await expect(country).toHaveValue("United Arab Emirates");
  await expect(page.locator("#market-area")).toBeVisible();

  // Typed but not picked while suggestions exist: blocked, and no project is created.
  await page.locator("#market-area").fill("Dubai Marina");
  await expect(page.getByRole("option", { name: /DIFC/ })).toBeVisible();
  await page.locator("#url").click();
  await page.getByRole("button", { name: "Analyse my brand" }).click();
  await expect(page.getByText("Choose a place from the list")).toBeVisible();
  expect(projectPosts).toHaveLength(0);

  // Picking the place turns it into a chip.
  await page.locator("#market-area").fill("DIF");
  await page.getByRole("option", { name: /DIFC/ }).click();
  await expect(page.getByRole("button", { name: "Clear area DIFC" })).toBeVisible();
  await noHorizontalOverflow(page);

  await page.getByRole("button", { name: "Analyse my brand" }).click();
  await expect.poll(() => projectPosts.length).toBe(1);
  expect(projectPosts[0]!.market.countryCodes[0]).toBe("AE");
  expect(projectPosts[0]!.market.area.place.neighborhood).toBe("DIFC");
  await expect.poll(() => createdId).not.toBeNull();

  const listed = await request.get("/api/projects");
  const { projects } = await listed.json();
  const stored = projects.find((project: any) => project.id === createdId);
  expect(stored?.market?.area?.place?.city).toBe("Dubai");
});

test("Search Console: disabled with setup help when not configured, and a cancelled sign-in never starts", async ({ page }) => {
  const projectPosts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/projects") projectPosts.push(req.url());
  });

  await page.goto("/trial/new");
  // The e2e server has no Google OAuth client in its environment.
  await expect(page.locator("#gsc-toggle")).toBeDisabled();
  await expect(page.locator("#gsc-connect")).toContainText(/isn.t set up on this computer/i);

  // The cancelled-sign-in notice only shows when OAuth is configured (without a
  // client the setup line is the whole story), so stub a configured, unconnected
  // status instead of giving the e2e server real Google credentials.
  await page.route("**/api/integrations/search-console", (route) =>
    route.fulfill({
      json: { status: { configured: true, connected: false, reason: "not_connected", redirectUri: "http://127.0.0.1:3100/api/integrations/search-console/callback" } },
    }),
  );
  await page.goto("/trial/new?url=https://example.com&gsc_return=1&gsc_status=denied");
  await expect(page.locator("#url")).toHaveValue("https://example.com");
  await expect(page.locator("#gsc-connect")).toContainText(/sign-in was cancelled/i);
  await expect(page.locator("#gsc-toggle")).not.toBeChecked();
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(/\/trial\/new/);
  expect(projectPosts).toEqual([]);
});

test("Landscape renders at once with a loading panel, and a static bar under reduced motion", async ({ page, request }) => {
  const project = await manualProject(request, "loading-panel");
  let landscapeAnswered = false;
  const delayLandscape = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    if (route.request().method() !== "GET") return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    landscapeAnswered = true;
    await route.continue();
  };
  await page.route("**/api/projects/*/landscape", delayLandscape);

  await page.goto(`/projects/${project.id}/landscape`);
  await expect(page.getByRole("heading", { name: "Topics & competitors" })).toBeVisible();
  await expect(page.getByRole("status").first()).toBeVisible();
  expect(landscapeAnswered).toBe(false);
  await noHorizontalOverflow(page);

  // While the (delayed) load runs, reduced motion swaps the sliding bar for a static one.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/projects/${project.id}/landscape`);
  await expect(page.locator('[data-loading-bar="static"]').first()).toBeVisible();
  await expect(page.locator('[data-loading-bar="animated"]').first()).toBeHidden();
  await page.unroute("**/api/projects/*/landscape", delayLandscape);
  await page.emulateMedia({ reducedMotion: null });
});

test("a stage page replays the event history once on open, then streams from where the first poll got to", async ({ page, request }) => {
  const project = await manualProject(request, "events-once");
  const eventRequests: URL[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === `/api/projects/${project.id}/events`) eventRequests.push(url);
  });

  await page.goto(`/projects/${project.id}/understand`);
  await expect(page.getByRole("heading", { name: "Your brand profile" })).toBeVisible();
  await expect.poll(() => eventRequests.some((url) => url.searchParams.get("stream") !== "false")).toBe(true);

  const fullReplays = eventRequests.filter((url) => (url.searchParams.get("since") ?? "0") === "0");
  expect(fullReplays).toHaveLength(1);
  expect(fullReplays[0]!.searchParams.get("stream")).toBe("false");
  // The manual profile's confirmation is in the log, so the stream starts after it.
  const stream = eventRequests.find((url) => url.searchParams.get("stream") !== "false")!;
  expect(Number(stream.searchParams.get("since"))).toBeGreaterThan(0);
});

test("Landscape and Prompt Intelligence persist review decisions and freeze exactly 10/10/10", async ({ page, request }) => {
  test.setTimeout(300_000);
  const consoleErrors: string[] = [];
  const unexpectedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const isExpectedRejectedEdit = response.status() === 400 && response.request().method() === "PATCH" && response.url().includes("/api/prompt-sets/");
    if (!isExpectedRejectedEdit) unexpectedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  const project = await manualProject(request, "northstar");

  await page.goto(`/projects/${project.id}/landscape`);
  await expect(page.getByRole("heading", { name: "Topics & competitors" })).toBeVisible();
  await expect(page.getByText("Topics", { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/not suggested|confirm anyway|% match/i)).toHaveCount(0);
  for (let index = 0; index < 4; index++) {
    const confirm = page.getByRole("button", { name: "Confirm", exact: true }).first();
    await expect(confirm).toBeVisible();
    await confirm.click();
  }
  await page.getByLabel("New competitor").fill("Rival Works");
  await page.getByRole("button", { name: "Add competitor" }).click();
  await expect(page.getByText("Added manually", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Rival Works")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Confirm & continue to prompts" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm & continue to prompts" }).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/prompts`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Prompt Intelligence" })).toBeVisible();
  // While the set is written the page shows a staged panel, never "0 / 30 selected".
  await expect(page.getByText("0 / 30 selected")).toHaveCount(0);
  await expect(page.getByText("30 / 30 selected")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Discovery", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Trade Offs", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Sentiment Analysis", { exact: true }).first()).toBeVisible();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "Prompt Intelligence" })).toBeVisible();
    await noHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole("button", { name: "Why?" }).first().click();
  await expect(page.getByText(/coverage contribution/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByLabel("Edit prompt").fill("Is Northstar Flow the best workflow automation platform?");
  await page.getByRole("button", { name: "Save and revalidate" }).click();
  await expect(page.getByText(/brand_leakage/i)).toBeVisible();
  await page.getByLabel("Edit prompt").fill("Which workflow automation options fit operations teams with complex approvals?");
  await page.getByRole("button", { name: "Save and revalidate" }).click();
  await expect(page.getByText("Which workflow automation options fit operations teams with complex approvals?")).toBeVisible();

  await page.getByRole("button", { name: "Regenerate" }).first().click();
  await expect(page.getByRole("button", { name: /validated alternatives/i }).first()).toBeVisible();
  const replaceButton = page.getByRole("button", { name: "Replace" }).first();
  await expect(replaceButton).toBeEnabled();
  await replaceButton.click();
  await expect(page.getByRole("button", { name: "Replace" }).first()).toBeEnabled();
  await expect(page.getByText("30 / 30 selected")).toBeVisible();
  await page.reload();
  await expect(page.getByText("30 / 30 selected")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Approve 30 / 30 prompts" }).click();
  await expect(page.getByText(/prompt set approved and frozen/i)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/prompts`));
  expect(consoleErrors.filter((message) => !message.includes("Failed to load resource"))).toEqual([]);
  expect(unexpectedResponses).toEqual([]);
});
