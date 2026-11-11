import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/projects/route";
import { getProject } from "@/lib/projects/repository";
import { parseMarketHint } from "@/lib/projects/market-hint";

// POST/GET /api/projects called as handlers against the per-file temp DB
// (tests/setup.ts). No network: URL normalisation is local and the market hint
// is built from the body alone.

let counter = 0;
const uniqueUrl = () => `https://intake-${Date.now()}-${counter++}.example/`;

async function post(body: unknown) {
  const request = new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  const response = await POST(request);
  return { status: response.status, json: (await response.json()) as any };
}

const difcPlace = {
  label: "whatever the browser said",
  formattedAddress: "DIFC - Dubai - United Arab Emirates",
  premise: null,
  street: null,
  neighborhood: "DIFC",
  district: null,
  city: "Dubai",
  region: "Dubai",
  country: "UAE",
  countryCode: "AE",
  postalCode: null,
  lat: 25.2125,
  lng: 55.2809,
  precision: "premise",
  provider: "photon",
  providerId: "N/123",
};

describe("POST /api/projects market hint", () => {
  it("stores a country + area hint and returns it parsed as project.market", async () => {
    const { status, json } = await post({ url: uniqueUrl(), market: { countryCodes: ["AE"], worldwide: false, area: { query: "DIFC", place: difcPlace } } });
    expect(status).toBe(201);
    const market = json.project.market;
    expect(market).toMatchObject({ v: 1, countryCodes: ["AE"], worldwide: false, source: "user" });
    expect(market.area.query).toBe("DIFC");
    expect(market.area.place).toMatchObject({ neighborhood: "DIFC", city: "Dubai", countryCode: "AE", country: "United Arab Emirates" });
    // The server recomputes the label and precision instead of trusting the browser.
    expect(market.area.place.label).toBe("DIFC, Dubai, United Arab Emirates");
    expect(market.area.place.precision).toBe("neighborhood");
    expect(Number.isNaN(Date.parse(market.capturedAt))).toBe(false);

    const row = await getProject(json.project.id);
    expect(row?.marketScope.startsWith("{")).toBe(true);
    expect(parseMarketHint(row?.marketScope)).toEqual(market);
  });

  it("stores \"auto\" when no market is given (Detect from my website)", async () => {
    const { status, json } = await post({ url: uniqueUrl() });
    expect(status).toBe(201);
    expect(json.project.market).toBeNull();
    expect((await getProject(json.project.id))?.marketScope).toBe("auto");
  });

  it("treats an explicit null or empty market as no hint", async () => {
    for (const market of [null, { countryCodes: [], worldwide: false, area: null }, {}]) {
      const { status, json } = await post({ url: uniqueUrl(), market });
      expect(status).toBe(201);
      expect((await getProject(json.project.id))?.marketScope).toBe("auto");
    }
  });

  it("stores worldwide and multi-country hints, upper-casing codes", async () => {
    const worldwide = await post({ url: uniqueUrl(), market: { worldwide: true } });
    expect(worldwide.json.project.market).toMatchObject({ worldwide: true, countryCodes: [], area: null });
    const two = await post({ url: uniqueUrl(), market: { countryCodes: ["ae", " sa "] } });
    expect(two.status).toBe(201);
    expect(two.json.project.market.countryCodes).toEqual(["AE", "SA"]);
  });

  it("keeps a typed area that search could not resolve as place: null", async () => {
    const { status, json } = await post({ url: uniqueUrl(), market: { countryCodes: ["AE"], area: { query: "  Some Area  ", place: null } } });
    expect(status).toBe(201);
    expect(json.project.market.area).toEqual({ query: "Some Area", place: null });
  });

  it("maps the legacy marketScope: an ISO code becomes a hint, \"global\" stores \"auto\"", async () => {
    const us = await post({ url: uniqueUrl(), marketScope: "US", language: "en" });
    expect(us.status).toBe(201);
    expect(us.json.project.market).toMatchObject({ countryCodes: ["US"], worldwide: false, area: null });
    expect(parseMarketHint((await getProject(us.json.project.id))?.marketScope)?.countryCodes).toEqual(["US"]);

    const global = await post({ url: uniqueUrl(), marketScope: "global", language: "en" });
    expect(global.json.project.market).toBeNull();
    expect((await getProject(global.json.project.id))?.marketScope).toBe("auto");

    // "UK" is not an ISO code; legacy junk never becomes a hint.
    const uk = await post({ url: uniqueUrl(), marketScope: "UK" });
    expect((await getProject(uk.json.project.id))?.marketScope).toBe("auto");
  });

  it("ignores the legacy marketScope when market is present", async () => {
    const { json } = await post({ url: uniqueUrl(), market: null, marketScope: "US" });
    expect((await getProject(json.project.id))?.marketScope).toBe("auto");
    const withCountry = await post({ url: uniqueUrl(), market: { countryCodes: ["IN"] }, marketScope: "US" });
    expect(withCountry.json.project.market.countryCodes).toEqual(["IN"]);
  });

  it("accepts and strips unknown keys such as gsc", async () => {
    const { status, json } = await post({ url: uniqueUrl(), gsc: { enabled: true }, market: { countryCodes: ["GB"] } });
    expect(status).toBe(201);
    expect(json.project).not.toHaveProperty("gsc");
    expect((await getProject(json.project.id))?.marketScope).not.toContain("gsc");
  });

  it.each([
    ["an unknown country code", { countryCodes: ["ZZ"] }, "market.countryCodes"],
    ["the non-ISO code UK", { countryCodes: ["UK"] }, "market.countryCodes"],
    ["worldwide with a country", { countryCodes: ["AE"], worldwide: true }, "market.worldwide"],
    ["an area without a country", { area: { query: "DIFC", place: null } }, "market.area"],
    ["an area with two countries", { countryCodes: ["AE", "SA"], area: { query: "DIFC", place: null } }, "market.area"],
    ["an area in another country", { countryCodes: ["IN"], area: { query: "DIFC", place: difcPlace } }, "market.area.place.countryCode"],
    ["a place with an impossible latitude", { countryCodes: ["AE"], area: { query: "DIFC", place: { ...difcPlace, lat: 91 } } }, "market.area.place.lat"],
    ["a place with an unknown provider", { countryCodes: ["AE"], area: { query: "DIFC", place: { ...difcPlace, provider: "mapbox" } } }, "market.area.place.provider"],
    ["a one-character area", { countryCodes: ["AE"], area: { query: "D", place: null } }, "market.area.query"],
    ["duplicate countries", { countryCodes: ["AE", "ae"] }, "market.countryCodes"],
  ])("rejects %s with 400 invalid_request", async (_label, market, path) => {
    const { status, json } = await post({ url: uniqueUrl(), market });
    expect(status).toBe(400);
    expect(json.error.code).toBe("invalid_request");
    // The intake focuses the market field when the message path starts with "market.".
    expect(json.error.message).toContain(path);
  });

  it("still rejects an unsafe URL before any market handling", async () => {
    const { status, json } = await post({ url: "http://127.0.0.1:8080", market: { countryCodes: ["AE"] } });
    expect(status).toBe(400);
    expect(json.error.code).toMatch(/^unsafe_url_/);
  });
});

describe("GET /api/projects", () => {
  it("returns the parsed market on every row, null for legacy and auto rows", async () => {
    const created = await post({ url: uniqueUrl(), market: { countryCodes: ["AE"], area: { query: "DIFC", place: difcPlace } } });
    const legacy = await post({ url: uniqueUrl(), marketScope: "global" });
    const response = await GET();
    const { projects } = (await response.json()) as { projects: any[] };
    const hinted = projects.find((p) => p.id === created.json.project.id);
    expect(hinted.market.area.place.city).toBe("Dubai");
    expect(hinted.marketScope.startsWith("{")).toBe(true);
    expect(projects.find((p) => p.id === legacy.json.project.id).market).toBeNull();
  });
});
