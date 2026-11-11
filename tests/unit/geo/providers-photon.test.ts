import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as geoSearchRoute } from "@/app/api/geo/search/route";
import { autocompletePlaces, searchPlaces } from "@/lib/geo/providers";

// Photon (keyless type-ahead) with a stubbed fetch: no request leaves the
// machine. tests/setup.ts removes GOOGLE_MAPS_API_KEY, so the Photon path runs.

interface Feature {
  name: string;
  countrycode: string;
  type?: string;
  city?: string;
  osm_id: number;
}

function photonBody(features: Feature[]) {
  return {
    features: features.map((f) => ({
      geometry: { coordinates: [55.28, 25.21] },
      properties: { name: f.name, countrycode: f.countrycode, type: f.type ?? "locality", city: f.city, osm_type: "N", osm_id: f.osm_id },
    })),
  };
}

let calls: URL[] = [];
let responder: (url: URL) => unknown;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const body = responder(url);
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const photonCalls = () => calls.filter((url) => url.hostname === "photon.komoot.io");

describe("Photon autocomplete country handling", () => {
  it("strict keeps only in-country suggestions, including on a cache hit", async () => {
    responder = () =>
      photonBody([
        { name: "Marina One", countrycode: "sg", osm_id: 1 },
        { name: "Marina Two", countrycode: "ae", city: "Dubai", osm_id: 2 },
        { name: "Marina Three", countrycode: "ae", city: "Dubai", osm_id: 3 },
        { name: "Marina Four", countrycode: "ae", city: "Dubai", osm_id: 4 },
      ]);
    const first = await autocompletePlaces("strict marina", { countryCode: "AE", strict: true });
    expect(first.map((s) => s.place.countryCode)).toEqual(["AE", "AE", "AE"]);
    expect(photonCalls()).toHaveLength(1);

    const second = await autocompletePlaces("strict marina", { countryCode: "AE", strict: true });
    expect(photonCalls()).toHaveLength(1); // served from the cache
    expect(second.map((s) => s.place.countryCode)).toEqual(["AE", "AE", "AE"]);
  });

  it("does not serve a result cached without a country to a country search unfiltered", async () => {
    responder = () =>
      photonBody([
        { name: "Harbour Elsewhere", countrycode: "au", osm_id: 11 },
        { name: "Harbour Local", countrycode: "ae", osm_id: 12 },
      ]);
    const open = await autocompletePlaces("cache harbour");
    expect(open.map((s) => s.place.countryCode)).toEqual(["AU", "AE"]);

    const strict = await autocompletePlaces("cache harbour", { countryCode: "AE", strict: true });
    expect(strict.every((s) => s.place.countryCode === "AE")).toBe(true);
    expect(strict.length).toBeGreaterThan(0);
  });

  it("keys the cache by country, so another country's search is not a cache hit", async () => {
    responder = () => photonBody([{ name: "Keyed Place", countrycode: "in", osm_id: 21 }, { name: "Keyed Place", countrycode: "ae", osm_id: 22 }, { name: "Keyed Other", countrycode: "ae", osm_id: 23 }, { name: "Keyed Third", countrycode: "ae", osm_id: 24 }]);
    await autocompletePlaces("keyed place", { countryCode: "AE" });
    expect(photonCalls()).toHaveLength(1);
    await autocompletePlaces("keyed place", { countryCode: "IN" });
    expect(photonCalls()).toHaveLength(2);
    await autocompletePlaces("keyed place", { countryCode: "IN" });
    expect(photonCalls()).toHaveLength(2);
    // Same country, strict vs not: separate entries too.
    await autocompletePlaces("keyed place", { countryCode: "AE", strict: true });
    expect(photonCalls()).toHaveLength(3);
  });

  it("without strict, re-orders in-country suggestions first and keeps the rest", async () => {
    responder = () =>
      photonBody([
        { name: "Bias Abroad", countrycode: "fr", osm_id: 31 },
        { name: "Bias Home", countrycode: "ae", osm_id: 32 },
      ]);
    const result = await autocompletePlaces("bias place", { countryCode: "ae" });
    expect(result.map((s) => s.title)).toEqual(["Bias Home", "Bias Abroad"]);
  });

  it("asks for 15 results with a country and no coordinates, 8 otherwise", async () => {
    responder = () => photonBody([{ name: "Limit", countrycode: "ae", osm_id: 41 }, { name: "Limit 2", countrycode: "ae", osm_id: 42 }, { name: "Limit 3", countrycode: "ae", osm_id: 43 }]);
    await autocompletePlaces("limit one", { countryCode: "AE", strict: true });
    expect(photonCalls().at(-1)?.searchParams.get("limit")).toBe("15");
    await autocompletePlaces("limit two", { countryCode: "AE", near: { lat: 25.2, lng: 55.3 } });
    expect(photonCalls().at(-1)?.searchParams.get("limit")).toBe("8");
    expect(photonCalls().at(-1)?.searchParams.get("lat")).toBe("25.2");
    await autocompletePlaces("limit three");
    expect(photonCalls().at(-1)?.searchParams.get("limit")).toBe("8");
  });

  it("strict with fewer than 3 local results retries once with the country name and merges by id", async () => {
    responder = (url) => {
      const q = url.searchParams.get("q") ?? "";
      if (q.endsWith(", United Arab Emirates")) {
        return photonBody([
          { name: "Retry Area", countrycode: "ae", osm_id: 51 }, // duplicate of the first response
          { name: "Retry Area North", countrycode: "ae", osm_id: 52 },
          { name: "Retry Area Abroad", countrycode: "gb", osm_id: 53 },
        ]);
      }
      return photonBody([
        { name: "Retry Area", countrycode: "ae", osm_id: 51 },
        { name: "Retry Area", countrycode: "gb", osm_id: 54 },
      ]);
    };
    const result = await autocompletePlaces("retry area", { countryCode: "AE", strict: true });
    expect(photonCalls().map((u) => u.searchParams.get("q"))).toEqual(["retry area", "retry area, United Arab Emirates"]);
    expect(result.map((s) => s.id)).toEqual(["N/51", "N/52"]);

    // Both requests are cached separately: repeating the search makes no request.
    await autocompletePlaces("retry area", { countryCode: "AE", strict: true });
    expect(photonCalls()).toHaveLength(2);
  });

  it("does not retry when the query already names the country, or when strict found enough", async () => {
    responder = () => photonBody([{ name: "Named", countrycode: "ae", osm_id: 61 }]);
    await autocompletePlaces("named, united arab emirates", { countryCode: "AE", strict: true });
    expect(photonCalls()).toHaveLength(1);
  });

  it("returns an empty list, without throwing, when Photon is unreachable", async () => {
    responder = () => new Error("offline");
    await expect(autocompletePlaces("offline place", { countryCode: "AE", strict: true })).resolves.toEqual([]);
  });

  it("reports a failed request as unavailable and skips the country-name retry", async () => {
    responder = () => new Error("offline");
    await expect(searchPlaces("outage place", { countryCode: "AE", strict: true })).resolves.toEqual({ suggestions: [], unavailable: true });
    // One timeout, not two: the retry only runs after Photon answered.
    expect(photonCalls()).toHaveLength(1);
  });

  it("an answer with no matches is not unavailable, and a failed retry keeps the first answer", async () => {
    responder = (url) => ((url.searchParams.get("q") ?? "").includes(",") ? new Error("offline") : photonBody([{ name: "Sparse Place", countrycode: "ae", osm_id: 71 }]));
    await expect(searchPlaces("sparse place", { countryCode: "AE", strict: true })).resolves.toMatchObject({ unavailable: false, suggestions: [{ id: "N/71" }] });
    expect(photonCalls()).toHaveLength(2);

    responder = () => photonBody([]);
    await expect(searchPlaces("nothing here", { countryCode: "AE" })).resolves.toEqual({ suggestions: [], unavailable: false });
  });
});

describe("GET /api/geo/search", () => {
  const search = async (query: string) => {
    const response = await geoSearchRoute(new NextRequest(`http://localhost/api/geo/search?${query}`));
    return { status: response.status, json: (await response.json()) as { suggestions?: Array<{ place: { countryCode: string | null } }>; unavailable?: boolean } };
  };

  it("normalises a legacy country code: profiles saved before the ISO fix still carry UK", async () => {
    responder = () => photonBody([{ name: "Legacy Abroad", countrycode: "au", osm_id: 81 }, { name: "Legacy Home", countrycode: "gb", osm_id: 82 }]);
    const { status, json } = await search("q=legacy%20place&country=UK");
    expect(status).toBe(200);
    expect(json.suggestions?.map((s) => s.place.countryCode)).toEqual(["GB", "AU"]);
    expect(json.unavailable).toBe(false);
  });

  it("searches without a country bias when the stored code names no country (FX)", async () => {
    responder = () => photonBody([{ name: "Unbiased Abroad", countrycode: "au", osm_id: 91 }, { name: "Unbiased Two", countrycode: "fr", osm_id: 92 }]);
    const { status, json } = await search("q=unbiased%20place&country=FX");
    expect(status).toBe(200);
    expect(json.suggestions?.map((s) => s.place.countryCode)).toEqual(["AU", "FR"]);
    expect(photonCalls().at(-1)?.searchParams.get("limit")).toBe("8");
  });

  it("still rejects a strict search whose country names no country", async () => {
    responder = () => photonBody([]);
    expect((await search("q=strict%20place&country=ZZ&strict=1")).status).toBe(400);
    expect(photonCalls()).toHaveLength(0);
    expect((await search("q=strict%20place&country=ae&strict=1")).status).toBe(200);
  });

  it("says unavailable when Photon failed, so the field does not claim there are no matches", async () => {
    responder = () => new Error("offline");
    const { status, json } = await search("q=route%20outage&country=AE&strict=1");
    expect(status).toBe(200);
    expect(json).toMatchObject({ suggestions: [], unavailable: true });
  });
});
