"use client";

import { useId, useState } from "react";
import { PlaceSearchCombobox } from "@/components/features/place-search";
import { ChipEditor, Disclosure, EditedBadge, EvidenceLink, FieldShell, ToldUsBadge, type ChipItem } from "@/components/features/profile-fields";
import { Button } from "@/components/ui/button";
import { Input, Label, Notice, Select, Spinner } from "@/components/ui/primitives";
import type { LocationEditInput } from "@/lib/client/api";
import { countryName } from "@/lib/geo/countries";
import { flagEmoji } from "@/lib/geo/flags";
import { placeHierarchy, placeLabel, type GeoLevel, type GeoPlace } from "@/lib/geo/types";
import type { LocationProfile, MarketArea, MarketScope } from "@/lib/profile/schema";
import { decideMarketArea, isAreaLevel, samePlaceName } from "@/lib/understanding/market-area";

// "Where is it, and where do its customers come from?" The demo that prompted
// this showed a DIFC salon as a US business; the card leads with the place in
// words a local would use, says the scope plainly, and lets the operator fix it
// with a place search that still works as plain text fields when offline.
//
// No confidence-level labels (operators found them confusing, feedback
// 2026-09-14) and no list of signals that pointed elsewhere: the
// badges only say who shaped the value ("Edited by you", "You told us"), and
// "Why?" lists the signals that agree with the place shown.

type Place = NonNullable<LocationProfile["primary"]>;

const LEVEL_LABELS: Partial<Record<GeoLevel, string>> = {
  country: "Country",
  region: "Region",
  city: "City",
  district: "District",
  neighborhood: "Neighbourhood",
  street: "Street",
};

const SIGNAL_LABELS: Record<string, string> = {
  structured_address: "Address in the site's structured data",
  website_address: "Address written on the website",
  domain_ending: "Website domain",
  phone: "Phone numbers",
  currency: "Currency of prices",
  countries_served: "Countries the site says it serves",
  coordinates: "Map pin on the website",
  geocoded: "Address looked up on the map",
  map_area_name: "Area name on the map",
  operator_stated: "You told us",
  website_area_name: "Area name on the website",
  search_console_country: "Google Search Console",
};

/** Signal kinds shown in "Why?" whatever country their value names: they are the reason for the place, not a vote against it. */
const ALWAYS_SHOWN_SIGNALS = new Set(["operator_stated", "search_console_country", "website_address"]);

/** Hint outcomes where the operator's intake answer shaped the value shown (conflict and unresolved get their own prompts). */
const TOLD_US_OUTCOMES = new Set(["agreed", "filled", "overrode", "noted"]);

/** Scope options in plain words; `multi-country` is the legacy spelling of `international`. */
const SCOPE_OPTIONS: Array<{ value: MarketScope; label: string }> = [
  { value: "hyperlocal", label: "Mostly one neighbourhood and nearby areas" },
  { value: "local", label: "Across one city" },
  { value: "regional", label: "Across a region, state or emirate" },
  { value: "national", label: "Across the whole country" },
  { value: "international", label: "In several countries" },
  { value: "global", label: "Worldwide" },
];

const WIDE_SCOPES = new Set<MarketScope>(["international", "multi-country", "global"]);

export function scopeSentence(scope: MarketScope, location: Pick<LocationProfile, "primary" | "countriesServed">): string | null {
  const place = location.primary;
  const country = place?.country ?? countryName(place?.countryCode) ?? null;
  const countries = location.countriesServed.length;
  switch (scope) {
    case "hyperlocal": {
      const area = place?.neighborhood ?? place?.district ?? place?.city;
      return area ? `Customers mostly come from ${area} and nearby areas` : "Customers mostly come from the surrounding neighbourhood";
    }
    case "local": {
      const city = place?.city ?? place?.region ?? place?.neighborhood;
      return city ? `Customers mostly come from across ${city}` : "Customers mostly come from across the city";
    }
    case "regional": {
      const region = place?.region && place.region !== place.city ? place.region : place?.city ? `the wider ${place.city} area` : null;
      return region ? `Serves customers across ${region}` : "Serves customers across the region";
    }
    case "national": {
      // The market country leads countriesServed. For an online company it can
      // differ from the head office: "Serves customers across Canada" was shown
      // for a Toronto company whose customers the operator placed in the US.
      const market = countryName(location.countriesServed[0]) ?? country;
      return market ? `Serves customers across ${market}` : "Serves customers across the country";
    }
    case "international":
    case "multi-country":
      return countries > 1 ? `Serves customers in ${countries} countries` : "Serves customers in several countries";
    case "global":
      return "Serves customers worldwide";
    default:
      return null;
  }
}

/**
 * True for a location the operator changed on the Understand page. A place
 * built only from the intake hint also carries `source: "user"`, so that alone
 * can't tell them apart: an edit is saved with confidence 100, which location
 * resolution never produces (it caps at 95, and lower for hint-built places).
 */
export function locationEditedByOperator(location: Pick<LocationProfile, "source" | "confidence" | "operatorHint">): boolean {
  if (location.source !== "user") return false;
  return !location.operatorHint || location.confidence >= 100;
}

/**
 * The "Why?" signals: positive votes for the place shown, plus the operator's
 * own statement, Search Console and a written address. Votes for another
 * country and weight-0 diagnostics stay stored but are not shown.
 */
export function visibleLocationSignals(location: Pick<LocationProfile, "signals" | "primary">): LocationProfile["signals"] {
  const cc = location.primary?.countryCode?.trim().toUpperCase() ?? null;
  return location.signals.filter(
    (signal, index, all) =>
      signal.weight > 0 &&
      (ALWAYS_SHOWN_SIGNALS.has(signal.kind) || (cc !== null && signal.value.trim().toUpperCase().endsWith(cc))) &&
      all.findIndex((other) => other.kind === signal.kind && other.value === signal.value) === index,
  );
}

/** The market area shown and edited: stored on new profiles, derived for older ones. */
export function cardMarketArea(location: LocationProfile, marketScope: MarketScope, onlineBusiness: boolean): MarketArea | null {
  if (location.marketArea) return location.marketArea;
  return decideMarketArea({
    placeBound: !onlineBusiness,
    scope: marketScope,
    primary: location.primary,
    branches: location.branches,
    presence: location.branches.length > 0 ? "multi_location" : "single_location",
    countries: location.countriesServed,
  });
}

/** The areas a place-bound business can be measured around: its own and its branches'. */
export function measurableAreas(location: Pick<LocationProfile, "primary" | "branches">): Array<{ level: "neighborhood" | "district"; name: string }> {
  const out: Array<{ level: "neighborhood" | "district"; name: string }> = [];
  for (const place of [location.primary, ...location.branches]) {
    const name = place?.neighborhood ?? place?.district ?? null;
    if (!name || out.some((item) => samePlaceName(item.name, name))) continue;
    out.push({ level: place?.neighborhood ? "neighborhood" : "district", name });
  }
  return out;
}

type SavablePlace = { [K in GeoLevel | "countryCode" | "postalCode" | "formattedAddress" | "providerId"]: string | null } & { lat: number | null; lng: number | null; provider: string | null };

/** A location edit that saves `place` as it is (the conflict box's "Keep" / "Use the website's location"). */
export function locationEditFrom(place: SavablePlace, marketScope?: MarketScope): LocationEditInput {
  return {
    primary: {
      premise: place.premise,
      street: place.street,
      neighborhood: place.neighborhood,
      district: place.district,
      city: place.city,
      region: place.region,
      country: place.country ?? countryName(place.countryCode),
      countryCode: place.countryCode,
      postalCode: place.postalCode,
      formattedAddress: place.formattedAddress,
      lat: place.lat,
      lng: place.lng,
      provider: place.provider,
      providerId: place.providerId,
    },
    ...(marketScope && marketScope !== "unknown" ? { marketScope: marketScope === "multi-country" ? "international" : marketScope } : {}),
  };
}

interface PlaceDraft {
  neighborhood: string;
  city: string;
  region: string;
  country: string;
  countryCode: string | null;
  district: string | null;
  street: string | null;
  premise: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  provider: string | null;
  providerId: string | null;
}

function draftFromPlace(place: Place | GeoPlace | null): PlaceDraft {
  // OpenStreetMap files areas like "Dubai Marina" as a district with no
  // neighbourhood; the editor only shows "Neighbourhood or area", so the
  // district moves there instead of vanishing from the form.
  const areaFromDistrict = !place?.neighborhood && Boolean(place?.district);
  return {
    neighborhood: place?.neighborhood ?? place?.district ?? "",
    city: place?.city ?? "",
    region: place?.region ?? "",
    country: place?.country ?? countryName(place?.countryCode) ?? "",
    countryCode: place?.countryCode ?? null,
    district: areaFromDistrict ? null : place?.district ?? null,
    street: place?.street ?? null,
    premise: place?.premise ?? null,
    postalCode: place?.postalCode ?? null,
    formattedAddress: place?.formattedAddress ?? null,
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
    provider: place?.provider ?? null,
    providerId: place?.providerId ?? null,
  };
}

export function LocationCard({
  projectId,
  location,
  marketScope,
  onlineBusiness,
  locked,
  onEditingChange,
  onSave,
}: {
  projectId: string;
  location: LocationProfile;
  marketScope: MarketScope;
  /** The classification says customers buy online rather than at a place. */
  onlineBusiness: boolean;
  locked: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSave: (edit: LocationEditInput) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<"keep" | "website" | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const place = location.primary;
  const marketArea = cardMarketArea(location, marketScope, onlineBusiness);
  // A chain measured across its city is shown as the city with its locations
  // listed, not as whichever branch the website listed first.
  const cityWide = Boolean(place && !onlineBusiness && marketArea?.level === "city" && location.branches.length > 0);
  const allLocations = place ? [place, ...location.branches] : location.branches;
  const label = cityWide ? [marketArea!.name, place?.country ?? countryName(place?.countryCode)].filter(Boolean).join(", ") : place ? place.label || placeLabel(place) || place.formattedAddress || "" : "";
  const hierarchy = place ? placeHierarchy(place).filter((h) => h.level !== "premise" && (!cityWide || (h.level !== "neighborhood" && h.level !== "district" && h.level !== "street"))) : [];
  const sentence = scopeSentence(marketScope, location);
  const showCountries = location.countriesServed.length > 0 && (onlineBusiness || WIDE_SCOPES.has(marketScope) || location.countriesServed.length > 1);
  const edited = locationEditedByOperator(location);
  const hint = location.operatorHint;
  const toldUs = Boolean(hint && !edited && TOLD_US_OUTCOMES.has(hint.outcome));
  const conflict = Boolean(hint && !edited && hint.outcome === "conflict" && hint.websitePlace);
  const unresolved = Boolean(hint && !edited && hint.outcome === "unresolved");
  // The operator's value overrides what the website suggested, so an edited or
  // hint-built place lists no website signals.
  const signals = location.source === "user" ? [] : visibleLocationSignals(location);
  const hasCoordinates = typeof place?.lat === "number" && typeof place?.lng === "number";

  function setOpen(next: boolean) {
    setEditing(next);
    onEditingChange?.(next);
  }

  async function decide(choice: "keep" | "website") {
    const target = choice === "keep" ? place : hint?.websitePlace;
    if (!target) return;
    setDeciding(choice);
    setDecisionError(null);
    try {
      await onSave(choice === "keep" ? locationEditFrom(target, marketScope) : locationEditFrom(target));
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Could not save the location.");
    } finally {
      setDeciding(null);
    }
  }

  const shortHint = place?.neighborhood ?? place?.district ?? place?.city ?? place?.country ?? countryName(place?.countryCode) ?? "my answer";
  const websiteLabel = hint?.websitePlace ? hint.websitePlace.label || placeLabel(hint.websitePlace) || hint.websitePlace.formattedAddress || "" : "";

  return (
    <FieldShell label="Location" badge={edited ? <EditedBadge edited /> : toldUs ? <ToldUsBadge /> : null}>
      <div>
        {conflict && !editing && (
          <div className="mb-3 rounded-xl border border-warn-500/30 bg-warn-100 p-3.5">
            <p className="text-sm text-ink-800">
              You told us <strong className="font-semibold">{hint!.label}</strong>, but the website&apos;s address is in{" "}
              <strong className="font-semibold">{websiteLabel || "another place"}</strong>.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void decide("keep")} disabled={locked || deciding !== null}>
                {deciding === "keep" ? <Spinner /> : `Keep ${shortHint}`}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void decide("website")} disabled={locked || deciding !== null}>
                {deciding === "website" ? <Spinner /> : "Use the website's location"}
              </Button>
            </div>
            {decisionError && (
              <p role="alert" className="mt-2 text-xs font-medium text-danger-600">
                {decisionError}
              </p>
            )}
          </div>
        )}
        {/* An intake area the map could not find. The editor used to open itself
            on mount: that hid this line, and it reopened on every visit (confirming
            keeps the outcome), holding back "Confirm profile". */}
        {unresolved && (
          <div className="mb-2">
            <p className="text-sm font-medium text-warn-600">{hint!.message ?? `We couldn't find “${hint!.label}” on the map. Check the area below.`}</p>
            {!editing && (
              <Button size="sm" className="mt-2" onClick={() => setOpen(true)} disabled={locked}>
                Search for “{hint!.label}”
              </Button>
            )}
          </div>
        )}
        {/* `!edited`, not `source !== "user"`: a place built only from the
            intake answer is also `source: "user"`, and a country-only answer
            for a place-bound business is exactly the one that needs checking. */}
        {location.needsConfirmation && !editing && !edited && !conflict && !unresolved && (
          <p className="mb-2 text-sm text-ink-600">Check this location before you confirm. Competitors and prompts are built around it.</p>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-7 tracking-[-0.01em] text-ink-950">{label || <span className="italic text-ink-400">No location found on the website</span>}</p>
            {cityWide && (
              <p className="mt-0.5 text-sm text-ink-600">
                {allLocations.length} locations across {marketArea!.name}: {allLocations.map((item) => item.neighborhood ?? item.district ?? (item.label || placeLabel(item))).filter(Boolean).join("; ")}
              </p>
            )}
            {!cityWide && place?.formattedAddress && place.formattedAddress !== label && <p className="mt-0.5 text-sm text-ink-600">{place.formattedAddress}</p>}
            {!cityWide && isAreaLevel(marketArea) && location.branches.length > 0 && (
              <p className="mt-0.5 text-sm text-ink-600">Measured around {marketArea.name}; its other {location.branches.length} location{location.branches.length === 1 ? "" : "s"} across {place?.city ?? "the city"} still count as branches.</p>
            )}
            {toldUs && hint && (
              <p className="mt-0.5 text-sm text-ink-600">
                You told us: {hint.countryCodes.length === 1 && flagEmoji(hint.countryCodes[0]) ? <span aria-hidden="true" className="mr-1">{flagEmoji(hint.countryCodes[0])}</span> : null}
                {hint.label}
                {hint.outcome === "agreed" ? " · matches your website" : ""}
              </p>
            )}
          </div>
          {!editing && (
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setOpen(true)} disabled={locked}>
              Change location
            </Button>
          )}
        </div>
        {toldUs && hint?.outcome === "noted" && hint.message && <p className="mt-2 text-sm text-ink-600">{hint.message}</p>}

        {hierarchy.length > 0 && (
          <ol aria-label="Place hierarchy" className="mt-2 flex flex-wrap items-center gap-1">
            {hierarchy.map((level, index) => (
              <li key={level.level} className="flex items-center gap-1">
                {index > 0 && (
                  <span aria-hidden="true" className="text-xs text-ink-300">
                    ›
                  </span>
                )}
                <span title={LEVEL_LABELS[level.level]} className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700">
                  {level.name}
                </span>
              </li>
            ))}
          </ol>
        )}

        {sentence && <p className="mt-3 text-sm text-ink-800">{sentence}.</p>}

        {location.nearbyAreas.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-400">Nearby:</span>
            {location.nearbyAreas.map((area) => (
              <span key={area} className="rounded-full border border-ink-200 bg-paper px-2.5 py-0.5 text-xs text-ink-700">
                {area}
              </span>
            ))}
          </div>
        )}

        {location.branches.length > 0 && !cityWide && (
          <p className="mt-2 text-xs text-ink-500">
            Plus {location.branches.length} other branch{location.branches.length === 1 ? "" : "es"}
            {location.branches.length <= 4 ? `: ${location.branches.map((b) => b.label || placeLabel(b)).filter(Boolean).join("; ")}` : ""}
          </p>
        )}

        {showCountries && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-400">Countries served:</span>
            {location.countriesServed.map((code) => (
              <span key={code} className="rounded-full border border-ink-200 bg-paper px-2.5 py-0.5 text-xs text-ink-700">
                {countryName(code) ?? code}
              </span>
            ))}
          </div>
        )}

        {hasCoordinates && !editing && (
          <a
            href={`https://www.openstreetmap.org/?mlat=${place!.lat}&mlon=${place!.lng}#map=17/${place!.lat}/${place!.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring mt-2 inline-block rounded text-xs font-medium text-brand-600 underline underline-offset-2 hover:text-brand-500"
          >
            View on map
          </a>
        )}
      </div>

      {editing ? (
        <LocationEditor
          location={location}
          marketScope={marketScope}
          onlineBusiness={onlineBusiness}
          initialQuery={unresolved ? hint!.label : ""}
          onCancel={() => setOpen(false)}
          onSave={async (edit) => {
            await onSave(edit);
            setOpen(false);
          }}
        />
      ) : (
        (location.rationale || signals.length > 0) && (
          <Disclosure>
            {location.rationale && <p>{location.rationale}</p>}
            {signals.length > 0 && (
              <ul className="mt-2 space-y-1">
                {signals.map((signal) => (
                  <li key={`${signal.kind}:${signal.value}`} className="flex flex-wrap gap-x-1.5">
                    <span className="font-medium text-ink-700">{SIGNAL_LABELS[signal.kind] ?? signal.kind.replace(/_/g, " ")}</span>
                    <span aria-hidden="true" className="text-ink-300">
                      →
                    </span>
                    <span className="break-words text-ink-700">{signal.value}</span>
                  </li>
                ))}
              </ul>
            )}
            <EvidenceLink projectId={projectId} evidenceIds={place?.evidenceIds ?? []} label="Show the website evidence" />
          </Disclosure>
        )
      )}
    </FieldShell>
  );
}

function LocationEditor({
  location,
  marketScope,
  onlineBusiness,
  initialQuery,
  onCancel,
  onSave,
}: {
  location: LocationProfile;
  marketScope: MarketScope;
  onlineBusiness: boolean;
  /** Pre-fills the place search (an intake area the map could not find). */
  initialQuery: string;
  onCancel: () => void;
  onSave: (edit: LocationEditInput) => Promise<void>;
}) {
  const ids = useId();
  const original = location.primary;
  const [resolving, setResolving] = useState(false);

  const [draft, setDraft] = useState<PlaceDraft>(() => draftFromPlace(original));
  /** City and country of the loaded or picked place, to tell a rename from a move. */
  const [baseline, setBaseline] = useState(() => ({ city: draft.city, country: draft.country }));
  const [scope, setScope] = useState<MarketScope | "">(marketScope === "multi-country" ? "international" : marketScope === "unknown" ? "" : marketScope);
  const [nearby, setNearby] = useState<ChipItem[]>(location.nearbyAreas.map((value) => ({ value })));
  const [countries, setCountries] = useState<ChipItem[]>(location.countriesServed.map((code) => ({ value: countryName(code) ?? code })));
  // Where customers are measured: the whole city, or one location's area.
  const currentArea = cardMarketArea(location, marketScope, onlineBusiness);
  const areaOptions = measurableAreas(location);
  const [measureAcross, setMeasureAcross] = useState<string>(() => (isAreaLevel(currentArea) ? `area:${currentArea.name}` : "city"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(resolved: GeoPlace) {
    const next = draftFromPlace(resolved);
    setDraft(next);
    setBaseline({ city: next.city, country: next.country });
    setError(null);
  }

  // Renaming the neighbourhood or region keeps the rest of the address; a
  // different city or country is a different place, so the street, pin and
  // provider id that belonged to the old one are dropped at save instead of
  // carried. Filling in a level the map left empty (OpenStreetMap often has no
  // city for Dubai areas) is not a different place and keeps them.
  const differs = (before: string, after: string) => Boolean(before.trim()) && before.trim().toLowerCase() !== after.trim().toLowerCase();
  const countryChanged = differs(baseline.country, draft.country);
  const placeChanged = countryChanged || differs(baseline.city, draft.city);
  const hasFinerDetail = Boolean(draft.street || draft.premise || draft.formattedAddress || draft.lat !== null);

  const effectiveScope = scope || marketScope;
  const showCountries = onlineBusiness || WIDE_SCOPES.has(effectiveScope);
  const showMeasureAcross = !onlineBusiness && (location.branches.length > 0 || areaOptions.length > 0) && Boolean(draft.city.trim());

  async function save() {
    const clean = (v: string | null) => (v && v.trim() ? v.trim().slice(0, 120) : null);
    if (![draft.neighborhood, draft.city, draft.region, draft.country].some((v) => v.trim())) {
      setError("Enter at least a city or a country.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        primary: {
          neighborhood: clean(draft.neighborhood),
          city: clean(draft.city),
          region: clean(draft.region),
          country: clean(draft.country),
          countryCode: countryChanged ? null : clean(draft.countryCode),
          ...(placeChanged
            ? { district: null, street: null, premise: null, postalCode: null, formattedAddress: null, lat: null, lng: null, provider: "user", providerId: null }
            : {
                district: clean(draft.district),
                street: clean(draft.street),
                premise: clean(draft.premise),
                postalCode: clean(draft.postalCode),
                formattedAddress: draft.formattedAddress?.trim() ? draft.formattedAddress.trim().slice(0, 300) : null,
                lat: draft.lat,
                lng: draft.lng,
                provider: clean(draft.provider),
                providerId: draft.providerId?.trim() ? draft.providerId.trim().slice(0, 300) : null,
              }),
        },
        ...(scope ? { marketScope: scope } : {}),
        ...(showMeasureAcross
          ? {
              marketArea: measureAcross.startsWith("area:")
                ? { level: areaOptions.find((option) => `area:${option.name}` === measureAcross)?.level ?? ("neighborhood" as const), name: measureAcross.slice(5) }
                : clean(draft.city)
                  ? { level: "city" as const, name: clean(draft.city)! }
                  : null,
            }
          : {}),
        nearbyAreas: nearby.map((n) => n.value.trim().slice(0, 120)).filter(Boolean).slice(0, 10),
        ...(showCountries ? { countriesServed: countries.map((c) => c.value.trim().slice(0, 120)).filter(Boolean).slice(0, 30) } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the location.");
      setSaving(false);
    }
  }

  return (
    <div className="sun-inset mt-3 p-4">
      {/* Biased to where the business was found. The bias is a preference, not a
          filter: a place in another country must still be findable when the
          detected country is the thing that is wrong. */}
      <PlaceSearchCombobox
        label="Search for the place"
        placeholder="Area, address or building"
        country={draft.countryCode ?? original?.countryCode ?? null}
        near={
          (draft.lat ?? original?.lat ?? null) !== null && (draft.lng ?? original?.lng ?? null) !== null
            ? { lat: (draft.lat ?? original?.lat)!, lng: (draft.lng ?? original?.lng)! }
            : null
        }
        fallbackToWorldwide
        initialQuery={initialQuery}
        autoFocus={Boolean(initialQuery)}
        emptyNote="No matching places. You can type the details below instead."
        unavailableNote="Place search is unavailable right now. Type the details below instead."
        onResolvingChange={setResolving}
        onPick={(resolved) => choose(resolved)}
      />

      {(draft.formattedAddress || draft.premise || draft.street) && (
        <p className={`mt-3 text-xs ${placeChanged ? "text-ink-300 line-through" : "text-ink-500"}`}>
          Address: {draft.formattedAddress || [draft.premise, draft.street].filter(Boolean).join(", ")}
        </p>
      )}
      {placeChanged && hasFinerDetail && (
        <p className="mt-1 text-xs text-warn-600">A different city or country is a different place, so the old street address and map pin will not be kept.</p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${ids}-neighborhood`}>Neighbourhood or area</Label>
          <Input id={`${ids}-neighborhood`} value={draft.neighborhood} maxLength={120} onChange={(e) => setDraft({ ...draft, neighborhood: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${ids}-city`}>City</Label>
          <Input id={`${ids}-city`} value={draft.city} maxLength={120} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${ids}-region`}>State, emirate or region</Label>
          <Input id={`${ids}-region`} value={draft.region} maxLength={120} onChange={(e) => setDraft({ ...draft, region: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${ids}-country`}>Country</Label>
          <Input id={`${ids}-country`} value={draft.country} maxLength={120} onChange={(e) => setDraft({ ...draft, country: e.target.value })} />
        </div>
        {showMeasureAcross && (
          <div className="sm:col-span-2">
            <Label htmlFor={`${ids}-measure`}>Measure customers across</Label>
            <Select id={`${ids}-measure`} value={measureAcross} onChange={(e) => setMeasureAcross(e.target.value)}>
              <option value="city">All of {draft.city.trim()}</option>
              {areaOptions.map((option) => (
                <option key={option.name} value={`area:${option.name}`}>
                  Around {option.name}{location.branches.length > 0 ? " (one location)" : ""}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-ink-500">Questions and competitors are built for this area; the locations themselves stay as they are.</p>
          </div>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor={`${ids}-scope`}>Where customers come from</Label>
          <Select id={`${ids}-scope`} value={scope} onChange={(e) => setScope(e.target.value as MarketScope | "")}>
            <option value="">Work it out from the location</option>
            {SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium text-ink-700">Nearby areas customers mention (up to 10)</p>
        <ChipEditor items={nearby} editing onChange={(next) => setNearby(next.slice(0, 10))} emptyLabel="" addLabel="Add a nearby area" />
      </div>

      {showCountries && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-ink-700">Countries served</p>
          <ChipEditor items={countries} editing onChange={(next) => setCountries(next.slice(0, 30))} emptyLabel="" addLabel="Add a country" />
        </div>
      )}

      {error && (
        <Notice tone="danger" role="alert" className="mt-3">
          {error}
        </Notice>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={saving || resolving}>
          {saving ? <Spinner /> : "Save location"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
