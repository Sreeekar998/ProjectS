// Schema.org extraction and normalization.
//
// Structured data is the highest-precision evidence a public website offers,
// and it is also the messiest: `@type` arrives as a string, an array, a
// `@graph` node, or nested inside another entity; the same organization is
// often declared three times with different completeness; and a meaningful
// fraction of real sites ship JSON-LD that does not parse at all.
//
// This module flattens all of that into a single list of `SchemaEntity`
// records with resolved `@id` references, so downstream resolvers never have
// to think about representation. It never throws on malformed input.

import type * as cheerio from "cheerio";

export interface SchemaEntity {
  types: string[];
  /** Raw properties with `@id` references resolved one level deep. */
  props: Record<string, unknown>;
  /** Which document node this came from, for evidence attribution. */
  origin: "jsonld" | "microdata" | "rdfa";
}

const MAX_ENTITIES = 200;
const MAX_DEPTH = 6;

export function normalizeTypes(value: unknown): string[] {
  if (typeof value === "string") return [stripSchemaPrefix(value)];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map(stripSchemaPrefix);
  return [];
}

function stripSchemaPrefix(type: string): string {
  return type.replace(/^https?:\/\/schema\.org\//i, "").replace(/^schema:/i, "").trim();
}

/** Parses every ld+json script in the document, tolerating malformed blocks. */
export function parseJsonLdBlocks(raw: string[]): unknown[] {
  const out: unknown[] = [];
  for (const block of raw) {
    const parsed = tolerantJsonParse(block);
    if (parsed === undefined) continue;
    if (Array.isArray(parsed)) out.push(...parsed);
    else out.push(parsed);
  }
  return out;
}

/**
 * JSON-LD in the wild frequently carries trailing commas, HTML comment
 * wrappers, or unescaped newlines inside strings. One repair attempt is worth
 * making because these blocks are high-value evidence; anything still broken
 * after that is dropped silently.
 */
function tolerantJsonParse(raw: string): unknown {
  const text = raw.trim().replace(/^<!--/, "").replace(/-->$/, "").trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to repair */
  }
  try {
    const repaired = text
      .replace(/,\s*([}\]])/g, "$1")
      // Strip raw control characters: unescaped newlines and tabs inside
      // string literals are the single most common JSON-LD defect.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/\r?\n/g, " ");
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}

/**
 * Flattens parsed JSON-LD into entities: expands `@graph`, walks nested
 * objects, and resolves `@id` references against the node index so that
 * `{"@id": "#org"}` inside a Product's `brand` becomes the real Organization.
 */
export function flattenJsonLd(parsed: unknown[]): SchemaEntity[] {
  const byId = new Map<string, Record<string, unknown>>();
  const collected: Array<Record<string, unknown>> = [];

  const walk = (node: unknown, depth: number): void => {
    if (collected.length >= MAX_ENTITIES || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    if (Array.isArray(obj["@graph"])) {
      for (const item of obj["@graph"] as unknown[]) walk(item, depth);
    }
    if (normalizeTypes(obj["@type"]).length > 0) {
      collected.push(obj);
      const atId = typeof obj["@id"] === "string" ? obj["@id"] : undefined;
      if (atId) byId.set(atId, obj);
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === "@graph" || key === "@context") continue;
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  };

  for (const node of parsed) walk(node, 0);

  const resolveRefs = (value: unknown, depth = 0): unknown => {
    if (depth > 3) return value;
    if (Array.isArray(value)) return value.map((v) => resolveRefs(v, depth + 1));
    if (!value || typeof value !== "object") return value;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "@id" && typeof obj["@id"] === "string") {
      const target = byId.get(obj["@id"]);
      return target ? { ...target } : value;
    }
    return value;
  };

  return collected.map((obj) => ({
    types: normalizeTypes(obj["@type"]),
    props: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolveRefs(v)])),
    origin: "jsonld" as const,
  }));
}

/** Minimal microdata reader: itemtype/itemprop pairs at one nesting level. */
export function extractMicrodata($: cheerio.CheerioAPI): SchemaEntity[] {
  const entities: SchemaEntity[] = [];
  $("[itemtype]").each((_, el) => {
    if (entities.length >= 50) return;
    const itemType = $(el).attr("itemtype") ?? "";
    const types = normalizeTypes(itemType.split(/\s+/).filter(Boolean));
    if (types.length === 0) return;
    const props: Record<string, unknown> = {};
    $(el)
      .find("[itemprop]")
      .slice(0, 40)
      .each((__, propEl) => {
        const name = $(propEl).attr("itemprop");
        if (!name) return;
        const value =
          $(propEl).attr("content") ??
          $(propEl).attr("datetime") ??
          $(propEl).attr("href") ??
          $(propEl).text().trim().slice(0, 300);
        if (value) props[name] = props[name] ? [props[name], value].flat() : value;
      });
    entities.push({ types, props, origin: "microdata" });
  });
  return entities;
}

/** RDFa-lite: `typeof` + `property` attributes, the pragmatic subset in use. */
export function extractRdfa($: cheerio.CheerioAPI): SchemaEntity[] {
  const entities: SchemaEntity[] = [];
  $("[typeof]").each((_, el) => {
    if (entities.length >= 25) return;
    const types = normalizeTypes(($(el).attr("typeof") ?? "").split(/\s+/).filter(Boolean));
    if (types.length === 0) return;
    const props: Record<string, unknown> = {};
    $(el)
      .find("[property]")
      .slice(0, 30)
      .each((__, propEl) => {
        const name = ($(propEl).attr("property") ?? "").replace(/^schema:/i, "");
        if (!name) return;
        const value = $(propEl).attr("content") ?? $(propEl).text().trim().slice(0, 300);
        if (value) props[name] = value;
      });
    entities.push({ types, props, origin: "rdfa" });
  });
  return entities;
}

// --- Typed accessors -------------------------------------------------------

export const ORGANIZATION_TYPES = new Set([
  "Organization",
  "Corporation",
  "LocalBusiness",
  "OnlineBusiness",
  "OnlineStore",
  "Store",
  "Restaurant",
  "FoodEstablishment",
  "Hotel",
  "LodgingBusiness",
  "AutoDealer",
  "AutomotiveBusiness",
  "MedicalOrganization",
  "MedicalClinic",
  "Hospital",
  "Dentist",
  "Physician",
  "Pharmacy",
  "EducationalOrganization",
  "CollegeOrUniversity",
  "School",
  "NGO",
  "GovernmentOrganization",
  "SportsOrganization",
  "TravelAgency",
  "RealEstateAgent",
  "ProfessionalService",
  "FinancialService",
  "BankOrCreditUnion",
  "InsuranceAgency",
  "AccountingService",
  "LegalService",
  "Attorney",
  "HealthAndBeautyBusiness",
  "HomeAndConstructionBusiness",
  "Plumber",
  "Electrician",
  "HVACBusiness",
  "ClothingStore",
  "ShoeStore",
  "SportingGoodsStore",
  "GroceryStore",
  "DepartmentStore",
  "ElectronicsStore",
  "FurnitureStore",
  "HardwareStore",
  "JewelryStore",
  "PetStore",
  "BookStore",
  "ToyStore",
  "HealthClub",
  "SportsActivityLocation",
  "Brand",
]);

export const OFFERING_TYPES = new Set([
  "Product",
  "ProductModel",
  "IndividualProduct",
  "ProductGroup",
  "Service",
  "Offer",
  "AggregateOffer",
  "OfferCatalog",
  "MenuItem",
  "Menu",
  "MenuSection",
  "Course",
  "MedicalProcedure",
  "MedicalTherapy",
  "MedicalTest",
  "MedicalSpecialty",
  "FinancialProduct",
  "LoanOrCredit",
  "BankAccount",
  "InvestmentOrDeposit",
  "InsuranceAgency",
  "Vehicle",
  "Car",
  "TouristTrip",
  "Trip",
  "HotelRoom",
  "Accommodation",
  "Event",
]);

export function hasAnyType(entity: SchemaEntity, set: Set<string>): boolean {
  return entity.types.some((t) => set.has(t));
}

export function firstString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = firstString(item);
      if (s) return s;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return firstString(obj.name ?? obj["@value"] ?? obj.title ?? null);
  }
  return null;
}

export function allStrings(value: unknown, limit = 20): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (out.length >= limit || depth > 3) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (t) out.push(t);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      walk(obj.name ?? obj["@value"] ?? obj.title ?? null, depth + 1);
    }
  };
  walk(value, 0);
  return [...new Set(out)];
}

export interface SchemaAddress {
  country?: string;
  region?: string;
  locality?: string;
  postalCode?: string;
  street?: string;
  /** Every part joined in postal order, for display and geocoding. */
  formatted?: string;
}

export function readAddresses(value: unknown): SchemaAddress[] {
  const out: SchemaAddress[] = [];
  const walk = (v: unknown, depth: number) => {
    if (out.length >= 40 || depth > 3) return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (typeof v === "string") {
      // `address: "6th Floor, Sheikh Zayed Road, Dubai"` is legal schema.org and
      // common on small-business sites; keep it as a formatted-only address.
      const text = v.trim();
      if (text.length >= 8 && text.length <= 300) out.push({ formatted: text });
      return;
    }
    if (!v || typeof v !== "object") return;
    const obj = v as Record<string, unknown>;
    const address: SchemaAddress = {
      country: firstString(obj.addressCountry) ?? undefined,
      region: firstString(obj.addressRegion) ?? undefined,
      locality: firstString(obj.addressLocality) ?? undefined,
      postalCode: firstString(obj.postalCode) ?? undefined,
      street: firstString(obj.streetAddress) ?? undefined,
    };
    const parts = [address.street, address.locality, address.region, address.postalCode, address.country].filter(Boolean);
    if (parts.length > 0) {
      address.formatted = parts.join(", ");
      // Street-only addresses used to be dropped; a DIFC address whose only
      // structured part is the street is still the strongest locality signal.
      out.push(address);
    }
    // A LocalBusiness may nest its address, or `location.address`.
    if (obj.address) walk(obj.address, depth + 1);
    if (obj.location) walk(obj.location, depth + 1);
  };
  walk(value, 0);
  return out;
}

// --- Schema.org type families ----------------------------------------------
//
// The leaf allowlists above (`ORGANIZATION_TYPES`, `OFFERING_TYPES`) are kept
// for their existing callers, but they were the reason a `HairSalon` page
// produced no brand, address or phone evidence: schema.org has ~150
// LocalBusiness leaves and the list had 55 entries. Family resolution walks
// the known subtree and falls back to a suffix heuristic, so an unlisted leaf
// such as `TattooParlor` or `PetGroomingBusiness` still counts as a business.

const LOCAL_BUSINESS_TYPES = new Set([
  "LocalBusiness", "AnimalShelter", "ArchiveOrganization", "AutomotiveBusiness", "AutoBodyShop", "AutoDealer", "AutoPartsStore", "AutoRental", "AutoRepair", "AutoWash", "GasStation", "MotorcycleDealer", "MotorcycleRepair",
  "ChildCare", "Dentist", "DryCleaningOrLaundry", "EmergencyService", "FireStation", "Hospital", "PoliceStation", "EmploymentAgency",
  "EntertainmentBusiness", "AdultEntertainment", "AmusementPark", "ArtGallery", "Casino", "ComedyClub", "MovieTheater", "NightClub",
  "FinancialService", "AccountingService", "AutomatedTeller", "BankOrCreditUnion", "InsuranceAgency",
  "FoodEstablishment", "Bakery", "BarOrPub", "Brewery", "CafeOrCoffeeShop", "Distillery", "FastFoodRestaurant", "IceCreamShop", "Restaurant", "Winery",
  "GovernmentOffice", "PostOffice",
  "HealthAndBeautyBusiness", "BeautySalon", "DaySpa", "HairSalon", "HealthClub", "NailSalon", "TattooParlor",
  "HomeAndConstructionBusiness", "Electrician", "GeneralContractor", "HVACBusiness", "HousePainter", "Locksmith", "MovingCompany", "Plumber", "RoofingContractor",
  "InternetCafe", "LegalService", "Attorney", "Notary", "Library",
  "LodgingBusiness", "BedAndBreakfast", "Campground", "Hostel", "Hotel", "Motel", "Resort", "SkiResort", "VacationRental",
  "MedicalBusiness", "CommunityHealth", "Dermatology", "DietNutrition", "Emergency", "Geriatric", "Gynecologic", "MedicalClinic", "CovidTestingFacility", "Midwifery", "Nursing", "Obstetric", "Oncologic", "Optician", "Optometric", "Otolaryngologic", "Pediatric", "Pharmacy", "Physician", "PhysiciansOffice", "IndividualPhysician", "Physiotherapy", "PlasticSurgery", "Podiatric", "PrimaryCare", "Psychiatric", "PublicHealth",
  "ProfessionalService", "RadioStation", "RealEstateAgent", "RecyclingCenter", "SelfStorage", "ShoppingCenter",
  "SportsActivityLocation", "BowlingAlley", "ExerciseGym", "GolfCourse", "PublicSwimmingPool", "SportsClub", "StadiumOrArena", "TennisComplex",
  "Store", "BikeStore", "BookStore", "ClothingStore", "ComputerStore", "ConvenienceStore", "DepartmentStore", "ElectronicsStore", "Florist", "FurnitureStore", "GardenStore", "GroceryStore", "HardwareStore", "HobbyShop", "HomeGoodsStore", "JewelryStore", "LiquorStore", "MensClothingStore", "MobilePhoneStore", "MovieRentalStore", "MusicStore", "OfficeEquipmentStore", "OutletStore", "PawnShop", "PetStore", "ShoeStore", "SportingGoodsStore", "TireShop", "ToyStore", "WholesaleStore",
  "TelevisionStation", "TouristInformationCenter", "TravelAgency",
]);

const ORGANIZATION_FAMILY_TYPES = new Set([
  "Organization", "Airline", "Consortium", "Corporation", "EducationalOrganization", "CollegeOrUniversity", "ElementarySchool", "HighSchool", "MiddleSchool", "Preschool", "School",
  "FundingScheme", "GovernmentOrganization", "LibrarySystem", "MedicalOrganization", "DiagnosticLab", "VeterinaryCare", "NGO", "NewsMediaOrganization", "OnlineBusiness", "OnlineStore",
  "PerformingGroup", "DanceGroup", "MusicGroup", "TheaterGroup", "PoliticalParty", "Project", "ResearchOrganization", "ResearchProject", "SearchRescueOrganization", "SportsOrganization", "SportsTeam", "WorkersUnion", "Brand",
]);

const PLACE_TYPES = new Set(["Place", "Accommodation", "CivicStructure", "Landform", "TouristAttraction", "TouristDestination"]);

const BUSINESS_SUFFIX = /(Store|Shop|Salon|Spa|Business|Service|Services|Agency|Clinic|Dealer|Restaurant|Cafe|Bakery|Hotel|Gym|Studio|Parlor|Parlour|Center|Centre|Contractor|Company|Firm|Office|Station|Repair|Rental|Laundry|Pharmacy|Physician|Dentist|Attorney|Notary|Florist|Winery|Brewery|Hostel|Motel|Resort|Library|Museum|School|University|College|Organization|Organisation|Corporation|Team|Union|Bank|Practice|Boutique|Grooming|Barber|Kitchen|Bar|Pub|Club|Lounge|Academy|Institute)$/;

export type SchemaFamily = "local_business" | "organization" | "place" | "offering" | "other";

/**
 * The family a schema.org type belongs to. `local_business` implies
 * `organization` for evidence purposes; the distinction is kept because a
 * LocalBusiness subtype is itself a strong "physical, local" business signal.
 */
export function schemaFamilyOf(type: string): SchemaFamily {
  const clean = stripSchemaPrefix(type);
  if (LOCAL_BUSINESS_TYPES.has(clean)) return "local_business";
  if (ORGANIZATION_FAMILY_TYPES.has(clean)) return "organization";
  if (ORGANIZATION_TYPES.has(clean)) return "organization";
  if (OFFERING_TYPES.has(clean)) return "offering";
  if (PLACE_TYPES.has(clean)) return "place";
  if (BUSINESS_SUFFIX.test(clean) && !/^(Web|Blog|Image|Video|Audio|Music|Software|Mobile)/.test(clean)) return "local_business";
  return "other";
}

export function isOrganizationLike(entity: SchemaEntity): boolean {
  return entity.types.some((t) => {
    const family = schemaFamilyOf(t);
    return family === "local_business" || family === "organization";
  });
}

export function isLocalBusinessLike(entity: SchemaEntity): boolean {
  return entity.types.some((t) => schemaFamilyOf(t) === "local_business");
}

export interface SchemaGeo {
  lat: number;
  lng: number;
}

/** `geo: { latitude, longitude }` or `geo: { "@type": "GeoCoordinates", … }`. */
export function readGeo(value: unknown): SchemaGeo | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const candidates = [obj.geo, obj.location && typeof obj.location === "object" ? (obj.location as Record<string, unknown>).geo : undefined, obj];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const g = candidate as Record<string, unknown>;
    const lat = Number(g.latitude ?? g.lat);
    const lng = Number(g.longitude ?? g.lng ?? g.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) return { lat, lng };
  }
  return null;
}

/** Opening hours as compact strings ("Mo-Fr 09:00-18:00" or the specification). */
export function readOpeningHours(value: unknown): string[] {
  const out: string[] = [];
  const spec = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const s = v as Record<string, unknown>;
    const days = allStrings(s.dayOfWeek, 7).map((d) => d.replace(/^https?:\/\/schema\.org\//, "").slice(0, 3));
    const opens = firstString(s.opens);
    const closes = firstString(s.closes);
    if (days.length > 0 && opens && closes) out.push(`${days.join(",")} ${opens}-${closes}`);
  };
  if (Array.isArray(value)) for (const item of value.slice(0, 14)) (typeof item === "string" ? out.push(item.trim()) : spec(item));
  else if (typeof value === "string") out.push(value.trim());
  else spec(value);
  return out.filter(Boolean).slice(0, 14);
}
