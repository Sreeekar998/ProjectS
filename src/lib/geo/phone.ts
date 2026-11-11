// Phone-number country detection.
//
// A `tel:+97145728973` link is one of the most reliable location signals a
// small business publishes, and a regex on "+971" cannot tell +1 US from +1
// Canada or +44 UK from a Jersey number. libphonenumber-js (Google's metadata)
// resolves the calling code, validates the national number, and says when the
// country is genuinely ambiguous.

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export interface PhoneCountry {
  e164: string;
  countryCode: string | null;
  callingCode: string;
  valid: boolean;
}

export function phoneCountry(raw: string, defaultCountry?: string | null): PhoneCountry | null {
  const text = raw.replace(/^tel:/i, "").trim();
  if (text.replace(/\D/g, "").length < 6) return null;
  try {
    const parsed = parsePhoneNumberFromString(text, defaultCountry ? (defaultCountry.toUpperCase() as CountryCode) : undefined);
    if (!parsed) return null;
    return {
      e164: parsed.number,
      countryCode: parsed.country ?? null,
      callingCode: parsed.countryCallingCode,
      valid: parsed.isValid(),
    };
  } catch {
    return null;
  }
}

/**
 * The single country a set of phone numbers points to, or null when they
 * disagree or none are international. Placeholder numbers ("+1 123-456-7890"
 * left in a theme) fail validation and are ignored.
 */
export function dominantPhoneCountry(numbers: string[], defaultCountry?: string | null): { countryCode: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const number of numbers) {
    const parsed = phoneCountry(number, defaultCountry);
    if (!parsed?.valid || !parsed.countryCode) continue;
    counts.set(parsed.countryCode, (counts.get(parsed.countryCode) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const [top, second] = ranked;
  if (second && second[1] === top![1]) return null;
  return { countryCode: top![0], count: top![1] };
}
