// Shorter names a company is actually called by.
//
// Confirmed entities carry the name a knowledge source records ("Pancheros
// Mexican Grill", "Brooks Sports"), while people and assistants say "Pancheros"
// and "Brooks". Matching only the recorded name made Trade Off prompts that
// named the rival the way people do fail validation and, worse, left those
// mentions uncounted in analysis.
//
// Nothing here comes from a brand list. A shorter form is accepted only when the
// company's own domain is exactly that form, or when every dropped word is a
// generic business descriptor. A plain leading-word rule is not safe: it would
// turn "Taco Bell" into "Taco" and "Under Armour" into "Under".

const DESCRIPTOR = /^(sports?|running|athletics?|apparel|footwear|international|group|brands?|company|co|inc|holdings?|grill|eats|kitchen|restaurants?)$/i;

/**
 * Business-type words people drop from a MULTI-word name: "Mokhtar Safadi
 * Beauty Lounge" is "Mokhtar Safadi", "Platinum Black Salon" is "Platinum
 * Black". They are never dropped from a one-word head: "Sisters Beauty Lounge"
 * stays whole, because "Sisters" alone would match ordinary text in answers
 * (analysis links mentions with these forms) and is not what people say.
 */
const CATEGORY_TAIL =
  /^(salons?|spa|beauty|lounge|studios?|barbers?|barbershop|grooming|hair|nails?|clinics?|dental|dentistry|medical|wellness|bakery|cafe|café|bistro|hotels?|resorts?|gyms?|fitness|clubs?|centre|center|kitchen|agency|digital|software|labs?|technologies|technology|solutions?|systems?|consulting|partners|associates|ltd|limited|llc|plc|gmbh|fzco|fze|dmcc)$/i;

/** A word that says what kind of business a name belongs to, dropped when people shorten it. */
export function isBusinessTypeWord(token: string): boolean {
  return CATEGORY_TAIL.test(token) || DESCRIPTOR.test(token);
}

/** "Chivalry: Gentlemen's Salon" and "Bloom | Nail Studio" are called by the part before the separator. */
function beforeSeparator(canonicalName: string): string | null {
  const match = canonicalName.match(/^(.{4,}?)\s*(?::|\s[|–—-]\s)\s*.+$/);
  return match ? match[1]!.trim() : null;
}

/** "F5, Inc." is "F5" and "Boomi, LP" is "Boomi": a legal suffix is never spoken. */
const LEGAL_SUFFIX = /,?\s+(inc\.?|incorporated|ltd\.?|limited|llc|l\.l\.c\.|plc|lp|l\.p\.|gmbh|ag|s\.a\.|sa|sas|srl|s\.r\.l\.|bv|b\.v\.|nv|pty\.?(\s+ltd\.?)?|co\.?,?\s+ltd\.?|corp\.?|corporation|fzco|fze|fz-llc|dmcc)\.?$/i;

function withoutLegalSuffix(canonicalName: string): string | null {
  const stripped = canonicalName.replace(LEGAL_SUFFIX, "").trim();
  return stripped !== canonicalName.trim() && letters(stripped).length >= 2 ? stripped : null;
}

function letters(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function domainLabels(domains: Array<string | null | undefined>): Set<string> {
  const labels = new Set<string>();
  for (const domain of domains) {
    if (!domain) continue;
    const host = domain.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0] ?? "";
    for (const label of host.split(".")) {
      if (label !== "www" && label.length >= 4) labels.add(letters(label));
    }
  }
  return labels;
}

/**
 * Leading parts of a multi-word name that stand for the whole company, longest
 * first. Four letters minimum, so "New" (New Balance) and "Del" (Del Taco)
 * never qualify.
 */
export function shortNameForms(canonicalName: string, domains: Array<string | null | undefined> = []): string[] {
  const forms: string[] = [];
  const labels = domainLabels(domains);
  // "The Warehouse Gym" is written "Warehouse Gym" in most answers; without
  // this form the gym's own mentions were counted as an untracked brand.
  const articleless = canonicalName.trim().replace(/^(?:the|a|an)\s+/i, "");
  if (articleless !== canonicalName.trim() && (articleless.split(/\s+/).length >= 2 || letters(articleless).length >= 6)) forms.push(articleless);
  const titled = beforeSeparator(canonicalName);
  if (titled && letters(titled).length >= 4 && !titled.split(/\s+/).every((token) => CATEGORY_TAIL.test(token) || DESCRIPTOR.test(token))) forms.push(titled);
  const unsuffixed = withoutLegalSuffix(canonicalName);
  if (unsuffixed && !forms.includes(unsuffixed)) forms.push(unsuffixed);
  const tokens = (unsuffixed ?? canonicalName).trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return forms;
  for (let keep = tokens.length - 1; keep >= 1; keep -= 1) {
    const head = tokens.slice(0, keep).join(" ");
    if (letters(head).length < 4 || forms.includes(head)) continue;
    const ownDomain = labels.has(letters(head));
    const tail = tokens.slice(keep).map((token) => token.replace(/[^A-Za-zé]/g, ""));
    const descriptorTail = tail.every((token) => DESCRIPTOR.test(token));
    // Dropping descriptors must leave a name, not an article and one common
    // word: "The Grooming Company" is not called "The Grooming" (every Trade
    // Off for a DIFC salon read "Atelier 10 or The Grooming"). A head that is
    // just "The X" only stands when the company's own domain is that head.
    const headWords = tokens.slice(0, keep).filter((token) => !/^(the|a|an)$/i.test(token));
    const articleAndOneWord = headWords.length < tokens.slice(0, keep).length && headWords.length <= 1;
    // One short word is not a name either: "Leon Grill" is not called "Leon"
    // (a Trade Off read "Leon vs Truffles"), while "Postman" and "Insomnia"
    // stand alone. Six letters, unless the company's own domain is that word.
    const oneShortWord = headWords.length === 1 && letters(headWords[0]!).length < 6;
    // Business-type tails ("Beauty Lounge", "Salon") drop only from a head of two or more real words.
    const categoryTail = headWords.length >= 2 && tail.every((token) => CATEGORY_TAIL.test(token) || DESCRIPTOR.test(token)) && !headWords.every((token) => CATEGORY_TAIL.test(token));
    if (ownDomain || (descriptorTail && !articleAndOneWord && !oneShortWord) || categoryTail) forms.push(head);
  }
  return forms;
}

/** The name to write in a prompt: the shortest supported form, else the recorded name. */
export function spokenName(canonicalName: string, domains: Array<string | null | undefined> = []): string {
  const forms = shortNameForms(canonicalName, domains);
  return forms.at(-1) ?? canonicalName;
}
