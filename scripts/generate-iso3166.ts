// Drift check for src/lib/geo/iso3166.ts. Downloads nothing and writes nothing.
//
//   npx tsx scripts/generate-iso3166.ts
//
// The ISO list is hand-maintained standards data. This compares it with the two
// independent sources already installed: libphonenumber's region list (which
// has AC and TA but lacks seven uninhabited territories) and the platform's
// CLDR names via Intl.DisplayNames. It exits non-zero on any unexpected
// difference, e.g. after a new ISO assignment or a typo in an edit.

import { getCountries } from "libphonenumber-js";
import { ISO_COUNTRIES } from "../src/lib/geo/iso3166";

const PHONE_ONLY = ["AC", "TA"];
const ISO_ONLY_NO_PHONE = ["AQ", "BV", "GS", "HM", "PN", "TF", "UM"];

function main(): number {
  const problems: string[] = [];
  const a2 = ISO_COUNTRIES.map((c) => c.a2);
  const a3 = ISO_COUNTRIES.map((c) => c.a3);
  if (ISO_COUNTRIES.filter((c) => c.official).length !== 249) problems.push(`expected 249 official codes, found ${ISO_COUNTRIES.filter((c) => c.official).length}`);
  if (new Set(a2).size !== a2.length) problems.push("duplicate alpha-2 codes");
  if (new Set(a3).size !== a3.length) problems.push("duplicate alpha-3 codes");
  for (const c of ISO_COUNTRIES) {
    if (!/^[A-Z]{2}$/.test(c.a2)) problems.push(`bad alpha-2 ${c.a2}`);
    if (!/^[A-Z]{3}$/.test(c.a3)) problems.push(`bad alpha-3 ${c.a3} (${c.a2})`);
  }

  const list = new Set(a2);
  const phone = new Set<string>(getCountries());
  const phoneExtra = [...phone].filter((code) => !list.has(code) && code !== "XK").sort();
  const listExtra = [...list].filter((code) => !phone.has(code)).sort();
  if (phoneExtra.join() !== PHONE_ONLY.join()) problems.push(`libphonenumber regions missing from the list: ${phoneExtra.join(", ")}`);
  if (listExtra.join() !== ISO_ONLY_NO_PHONE.join()) problems.push(`list codes unknown to libphonenumber: ${listExtra.join(", ")}`);

  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const nameDiffs: string[] = [];
  for (const c of ISO_COUNTRIES) {
    const name = names.of(c.a2);
    if (!name || name === c.a2) problems.push(`Intl has no name for ${c.a2}`);
    else if (name !== c.name) nameDiffs.push(`${c.a2}: list "${c.name}", Intl "${name}"`);
  }

  console.log(`${ISO_COUNTRIES.length} codes checked against libphonenumber (${phone.size}) and Intl.DisplayNames.`);
  if (nameDiffs.length) console.log(`English short names that differ from CLDR (informational):\n  ${nameDiffs.join("\n  ")}`);
  if (problems.length) {
    console.error(`Drift found:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  console.log("No drift.");
  return 0;
}

process.exitCode = main();
