// The countries a business sells into, read from the confirmed profile.
//
// Downstream stages used `location.primary.countryCode` as "the" country. For a
// place-bound business that is right: customers visit the place. For an online
// business it is only the head office, so a Dubai-HQ software company whose
// operator said "Saudi Arabia" got "in the UAE" prompts and UAE competitors.
// `resolveLocation` and `applyLocationEdit` put the market country first in
// `countriesServed`, so non-place-bound profiles read it from there.
//
// Client-safe.

import { countryCodeFrom } from "@/lib/geo/countries";
import { isCountryCode } from "@/lib/geo/iso3166";
import type { BusinessProfile } from "@/lib/profile/schema";
import { PLACE_BOUND_KINDS, type BusinessKind } from "./kinds";

export interface MarketCountries {
  /** The main market country (ISO alpha-2), or null when nothing is known. */
  primary: string | null;
  /** Every market country, primary first, de-duplicated. */
  all: string[];
  /** The confirmed scope is global. */
  worldwide: boolean;
}

// Profiles written before the ISO fix can hold "UK" for Great Britain; map such
// codes through the resolver instead of dropping the country.
function normalizeCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (isCountryCode(trimmed)) return trimmed.toUpperCase();
  return countryCodeFrom(trimmed);
}

type MarketProfile = Pick<BusinessProfile, "location" | "classification" | "marketScope" | "markets">;

export function marketCountries(profile: MarketProfile): MarketCountries {
  const worldwide = profile.marketScope?.value === "global";
  const location = profile.location;
  const ordered: Array<string | null> = [];

  if (location) {
    const kind = (profile.classification?.kind ?? "other") as BusinessKind;
    const placeBound = PLACE_BOUND_KINDS.has(kind) && profile.classification?.physicalPresence !== "online_only";
    const headOffice = location.primary?.countryCode ?? null;
    const served = location.countriesServed ?? [];
    if (placeBound) ordered.push(headOffice, ...served);
    // A worldwide business has no home market: its head office is where it
    // is, not where its customers are. Postman (San Francisco, "Worldwide"
    // chosen at intake) got "in the US" Discovery prompts and a US primary
    // market because the head office was pushed here as a served country.
    // Only countries the site or the operator actually named stay.
    else if (worldwide) ordered.push(...served);
    else ordered.push(served[0] ?? null, headOffice, ...served);
  } else {
    // Profiles from before first-class locations only have `markets`.
    const markets = profile.markets ?? [];
    ordered.push(markets.find((market) => market.isPrimary && market.countryCode)?.countryCode ?? null);
    for (const market of markets) ordered.push(market.countryCode);
  }

  const all: string[] = [];
  for (const value of ordered) {
    const code = normalizeCode(value);
    if (code && !all.includes(code)) all.push(code);
  }
  return { primary: all[0] ?? null, all, worldwide };
}
