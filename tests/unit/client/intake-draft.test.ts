import { describe, expect, it } from "vitest";
import {
  INTAKE_DRAFT_KEY,
  INTAKE_DRAFT_TTL_MS,
  decideIntakeReturn,
  intakeAreaFromPick,
  intakeChoiceFromMarket,
  intakeMarket,
  parseIntakeDraft,
  saveIntakeDraft,
  takeIntakeDraft,
  type DraftStorage,
  type IntakeDraft,
} from "@/lib/client/intake-draft";
import { MarketHintInputSchema } from "@/lib/projects/market-hint";

function memoryStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function throwingStorage(): DraftStorage {
  return {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
}

const NOW = 1_800_000_000_000;

const market = {
  countryCodes: ["AE"],
  worldwide: false,
  area: {
    query: "DIFC",
    place: {
      label: "DIFC, Dubai, United Arab Emirates",
      formattedAddress: null,
      premise: null,
      street: null,
      neighborhood: "DIFC",
      district: null,
      city: "Dubai",
      region: null,
      country: "United Arab Emirates",
      countryCode: "AE",
      postalCode: null,
      lat: 25.21,
      lng: 55.28,
      precision: "neighborhood" as const,
      provider: "photon" as const,
      providerId: "N/1",
    },
  },
};

function saved(overrides: Partial<IntakeDraft> = {}): IntakeDraft {
  return { v: 1, url: "https://salon.example", market, areaLabel: "DIFC", searchConsole: true, savedAt: NOW, ...overrides };
}

describe("intake draft storage", () => {
  it("round-trips a draft and removes it after it is taken", () => {
    const storage = memoryStorage();
    expect(saveIntakeDraft(storage, { url: "https://salon.example", market, areaLabel: "DIFC", searchConsole: true }, NOW)).toBe(true);
    expect(storage.data.has(INTAKE_DRAFT_KEY)).toBe(true);
    const draft = takeIntakeDraft(storage, NOW + 60_000);
    expect(draft).toEqual(saved());
    expect(storage.data.has(INTAKE_DRAFT_KEY)).toBe(false);
    expect(takeIntakeDraft(storage, NOW + 60_000)).toBeNull();
  });

  it("expires after 15 minutes and is still removed", () => {
    const storage = memoryStorage();
    saveIntakeDraft(storage, { url: "https://salon.example", market: null, areaLabel: null, searchConsole: false }, NOW);
    expect(parseIntakeDraft(storage.getItem(INTAKE_DRAFT_KEY), NOW + INTAKE_DRAFT_TTL_MS)).not.toBeNull();
    expect(takeIntakeDraft(storage, NOW + INTAKE_DRAFT_TTL_MS + 1)).toBeNull();
    expect(storage.data.has(INTAKE_DRAFT_KEY)).toBe(false);
  });

  it("rejects malformed JSON, wrong versions and invalid markets without throwing", () => {
    expect(parseIntakeDraft("{", NOW)).toBeNull();
    expect(parseIntakeDraft("[]", NOW)).toBeNull();
    expect(parseIntakeDraft("null", NOW)).toBeNull();
    expect(parseIntakeDraft(null, NOW)).toBeNull();
    expect(parseIntakeDraft(JSON.stringify({ ...saved(), v: 2 }), NOW)).toBeNull();
    expect(parseIntakeDraft(JSON.stringify({ ...saved(), url: "  " }), NOW)).toBeNull();
    expect(parseIntakeDraft(JSON.stringify({ ...saved(), savedAt: "yesterday" }), NOW)).toBeNull();
    expect(parseIntakeDraft(JSON.stringify({ ...saved(), market: { countryCodes: ["ZZ"] } }), NOW)).toBeNull();
    expect(parseIntakeDraft(JSON.stringify({ ...saved(), market: { countryCodes: ["AE"], worldwide: true } }), NOW)).toBeNull();
    // A draft dated far in the future is not trusted either.
    expect(parseIntakeDraft(JSON.stringify(saved({ savedAt: NOW + 10 * 60_000 })), NOW)).toBeNull();
  });

  it("normalises a stored market through the intake schema", () => {
    const draft = parseIntakeDraft(JSON.stringify({ ...saved(), market: { countryCodes: ["ae"] }, searchConsole: "yes" }), NOW);
    expect(draft?.market).toEqual({ countryCodes: ["AE"], worldwide: false, area: null });
    expect(draft?.searchConsole).toBe(false);
  });

  it("survives storage that throws on every access", () => {
    const storage = throwingStorage();
    expect(saveIntakeDraft(storage, { url: "https://salon.example", market: null, areaLabel: null, searchConsole: true }, NOW)).toBe(false);
    expect(takeIntakeDraft(storage, NOW)).toBeNull();
    expect(saveIntakeDraft(null, { url: "x", market: null, areaLabel: null, searchConsole: false })).toBe(false);
    expect(takeIntakeDraft(null)).toBeNull();
  });
});

describe("decideIntakeReturn", () => {
  const draft = saved();

  it("does nothing on a normal visit", () => {
    expect(decideIntakeReturn({ gscReturn: null, gscStatus: null, url: "https://salon.example", draft })).toEqual({
      returning: false,
      draft: null,
      searchConsole: false,
      autoStart: false,
      notice: null,
    });
  });

  it("connected with a draft: restores, switches the toggle on and starts once", () => {
    expect(decideIntakeReturn({ gscReturn: "1", gscStatus: "connected", url: "https://salon.example", draft })).toEqual({
      returning: true,
      draft,
      searchConsole: true,
      autoStart: true,
      notice: null,
    });
  });

  it("connected without a draft (expired or storage blocked): toggle on, but waits for a click", () => {
    const decision = decideIntakeReturn({ gscReturn: "1", gscStatus: "connected", url: "https://salon.example", draft: null });
    expect(decision).toMatchObject({ returning: true, draft: null, searchConsole: true, autoStart: false, notice: null });
  });

  it("denied: restores the fields, toggle off, notice, never starts", () => {
    expect(decideIntakeReturn({ gscReturn: "1", gscStatus: "denied", url: "https://salon.example", draft })).toEqual({
      returning: true,
      draft,
      searchConsole: false,
      autoStart: false,
      notice: "denied",
    });
  });

  it("error, or an unknown status: error notice, never starts", () => {
    expect(decideIntakeReturn({ gscReturn: "1", gscStatus: "error", url: null, draft })).toMatchObject({ draft, autoStart: false, notice: "error", searchConsole: false });
    expect(decideIntakeReturn({ gscReturn: "1", gscStatus: "weird", url: null, draft })).toMatchObject({ autoStart: false, notice: "error" });
  });

  it("Back from Google's page (gsc_return without a status): restores the fields, toggle off, no notice, never starts", () => {
    expect(decideIntakeReturn({ gscReturn: "1", gscStatus: null, url: "https://salon.example", draft })).toEqual({
      returning: true,
      draft,
      searchConsole: false,
      autoStart: false,
      notice: null,
    });
  });

  it("treats the callback's state-mismatch redirect (gsc_status without gsc_return) as a return", () => {
    expect(decideIntakeReturn({ gscReturn: null, gscStatus: "error", url: null, draft: null })).toMatchObject({ returning: true, autoStart: false, notice: "error" });
  });

  it("ignores a draft saved for a different website", () => {
    const decision = decideIntakeReturn({ gscReturn: "1", gscStatus: "connected", url: "https://other.example", draft });
    expect(decision).toMatchObject({ draft: null, autoStart: false, searchConsole: true });
    // Trailing slash and case differences are the same website.
    expect(decideIntakeReturn({ gscReturn: "1", gscStatus: "connected", url: "HTTPS://salon.example/", draft }).autoStart).toBe(true);
  });
});

describe("intake form values → POST body", () => {
  const difc = market.area.place;
  const pick = { title: "DIFC", subtitle: "Dubai, United Arab Emirates", place: { ...difc, confidence: 40, evidenceIds: ["ev_1"] } };

  it("builds no market for Detect, a worldwide market, and a country market", () => {
    expect(intakeMarket("auto", null)).toBeNull();
    expect(intakeMarket("ZZ", null)).toBeNull();
    expect(intakeMarket("worldwide", { query: "x", place: null })).toEqual({ countryCodes: [], worldwide: true, area: null });
    expect(intakeMarket("ae", null)).toEqual({ countryCodes: ["AE"], worldwide: false, area: null });
  });

  it("sends a picked area as a place without evidence ids or confidence", () => {
    const area = intakeAreaFromPick(pick, "AE");
    expect(area.query).toBe("DIFC");
    expect(area.place).toEqual(difc);
    expect(area.place).not.toHaveProperty("confidence");
    expect(MarketHintInputSchema.safeParse(intakeMarket("AE", area)).success).toBe(true);
  });

  it("sends a pick with no area levels, or in another country, as text to geocode later", () => {
    const labelOnly = { ...pick, place: { ...difc, neighborhood: null, city: null, region: null, district: null, countryCode: null } };
    expect(intakeAreaFromPick(labelOnly, "AE")).toEqual({ query: "DIFC, Dubai, United Arab Emirates", place: null });
    const abroad = { ...pick, place: { ...difc, countryCode: "SA" } };
    expect(intakeAreaFromPick(abroad, "AE").place).toBeNull();
  });

  it("restores the form from a saved market", () => {
    expect(intakeChoiceFromMarket(null, null)).toEqual({ country: "auto", areaPick: null, areaQuery: "" });
    expect(intakeChoiceFromMarket({ countryCodes: [], worldwide: true, area: null }, null).country).toBe("worldwide");
    expect(intakeChoiceFromMarket({ countryCodes: ["AE"], worldwide: false, area: { query: "Some Area", place: null } }, null)).toEqual({ country: "AE", areaPick: null, areaQuery: "Some Area" });
    const restored = intakeChoiceFromMarket(market, "DIFC");
    expect(restored.country).toBe("AE");
    expect(restored.areaPick).toMatchObject({ title: "DIFC", subtitle: "Dubai, United Arab Emirates", place: difc });
  });
});
