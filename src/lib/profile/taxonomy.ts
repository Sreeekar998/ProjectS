// Project Sun industry taxonomy.
//
// Industry must be a stable, closed vocabulary rather than free LLM text:
// downstream topic and competitor discovery compare industries across runs,
// and "Retail — Apparel & Sporting Goods" is only useful if the same business
// gets the same label every time.
//
// Sectors follow the shape of NAICS 2-digit sectors and common commercial
// content taxonomies, but the labels are written for a marketing user rather
// than an economist — we keep the NAICS hint on each category for traceability
// without putting a numeric code in the UI.

export interface IndustryCategory {
  /** Stable id used in storage and comparisons. */
  id: string;
  /** Sector label shown as `industry.primary`. */
  sector: string;
  /** Category label shown as `industry.secondary`. */
  category: string;
  /** Loose NAICS sector hint, for traceability only. */
  naicsHint?: string;
  /** Schema.org types that pin this category outright. */
  schemaTypes?: string[];
  /** Keyword signals, matched against the evidence corpus. */
  keywords: string[];
  /** Signals that argue against this category despite a keyword hit. */
  negativeKeywords?: string[];
}

export const INDUSTRY_TAXONOMY: IndustryCategory[] = [
  // --- Retail & consumer goods --------------------------------------------
  {
    id: "retail.apparel_sporting_goods",
    sector: "Retail",
    category: "Apparel & Sporting Goods",
    naicsHint: "448 / 459",
    schemaTypes: ["ClothingStore", "ShoeStore", "SportingGoodsStore"],
    keywords: ["footwear", "sneakers", "trainers", "running shoes", "apparel", "sportswear", "activewear", "jerseys", "athletic", "clothing", "t-shirts", "hoodies", "leggings", "sports equipment", "size guide", "menswear", "womenswear"],
  },
  {
    id: "retail.beauty_personal_care",
    sector: "Retail",
    category: "Beauty & Personal Care",
    naicsHint: "456",
    schemaTypes: ["HealthAndBeautyBusiness"],
    keywords: ["skincare", "cosmetics", "makeup", "fragrance", "serum", "moisturiser", "moisturizer", "haircare", "shampoo", "beauty products", "spf", "cruelty-free"],
  },
  {
    id: "retail.grocery_food",
    sector: "Retail",
    category: "Grocery & Packaged Food",
    naicsHint: "445",
    schemaTypes: ["GroceryStore", "Bakery"],
    keywords: ["grocery", "supermarket", "fresh produce", "pantry", "snacks", "organic food", "packaged food", "coffee beans", "tea", "spices"],
  },
  {
    id: "retail.electronics",
    sector: "Retail",
    category: "Consumer Electronics",
    naicsHint: "449",
    schemaTypes: ["ElectronicsStore", "ComputerStore"],
    keywords: ["laptops", "smartphones", "headphones", "televisions", "gadgets", "consumer electronics", "accessories", "warranty", "gaming console"],
  },
  {
    id: "retail.home_furniture",
    sector: "Retail",
    category: "Home & Furniture",
    naicsHint: "449",
    schemaTypes: ["FurnitureStore", "HomeGoodsStore", "HardwareStore"],
    keywords: ["furniture", "sofa", "mattress", "home decor", "kitchenware", "bedding", "lighting", "interior"],
  },
  {
    id: "retail.jewellery_luxury",
    sector: "Retail",
    category: "Jewellery & Luxury Goods",
    schemaTypes: ["JewelryStore"],
    keywords: ["jewellery", "jewelry", "diamond", "gold", "watches", "luxury", "bridal", "gemstone", "carat"],
  },
  {
    id: "retail.books_media",
    sector: "Retail",
    category: "Books, Music & Media",
    naicsHint: "459",
    schemaTypes: ["BookStore", "MusicStore"],
    keywords: ["books", "book", "ebook", "audiobook", "paperback", "hardback", "hardcover", "authors", "fiction", "non-fiction", "nonfiction", "bestsellers", "titles", "isbn", "vinyl", "magazines", "stationery", "comics", "graphic novels"],
  },
  {
    id: "retail.general_merchandise",
    sector: "Retail",
    category: "General Merchandise & Marketplace",
    naicsHint: "455",
    schemaTypes: ["DepartmentStore", "OnlineStore", "Store"],
    keywords: ["shop online", "free shipping", "add to cart", "returns policy", "wide range of products", "departments", "best sellers"],
  },

  // --- Automotive ----------------------------------------------------------
  {
    id: "automotive.manufacturer",
    sector: "Automotive",
    category: "Vehicle Manufacturing",
    naicsHint: "336",
    keywords: ["our vehicles", "model lineup", "engine", "horsepower", "drivetrain", "electric vehicle", "ev range", "hybrid", "chassis", "assembly plant", "build & price", "configurator"],
    negativeKeywords: ["test drive at our dealership", "pre-owned inventory"],
  },
  {
    id: "automotive.dealership",
    sector: "Automotive",
    category: "Vehicle Retail & Dealership",
    naicsHint: "441",
    schemaTypes: ["AutoDealer", "AutoRepair", "AutomotiveBusiness"],
    keywords: ["test drive", "trade-in", "certified pre-owned", "used cars", "new inventory", "vin", "finance your", "service department", "book a service", "showroom", "msrp", "on-road price"],
  },

  // --- Software & technology ----------------------------------------------
  {
    id: "software.b2b_saas",
    sector: "Software",
    category: "B2B SaaS & Business Software",
    naicsHint: "5112 / 5182",
    schemaTypes: ["SoftwareApplication", "WebApplication"],
    keywords: ["book a demo", "request a demo", "free trial", "integrations", "api documentation", "workflow", "dashboard", "per user per month", "sso", "soc 2", "single sign-on", "enterprise plan", "seats", "onboarding", "automation platform"],
  },
  {
    id: "software.developer_infrastructure",
    sector: "Software",
    category: "Developer Tools & Infrastructure",
    keywords: ["sdk", "cli", "open source", "api reference", "kubernetes", "deploy", "latency", "uptime", "npm install", "github", "serverless", "observability", "self-hosted"],
  },
  {
    id: "software.consumer_app",
    sector: "Software",
    category: "Consumer Apps & Digital Services",
    schemaTypes: ["MobileApplication"],
    keywords: ["download the app", "app store", "google play", "free to use", "premium subscription", "millions of users"],
  },
  {
    id: "technology.it_services",
    sector: "Technology Services",
    category: "IT Services & Consulting",
    naicsHint: "5415",
    keywords: ["digital transformation", "managed services", "system integration", "it consulting", "cloud migration", "staff augmentation", "offshore development", "engagement model"],
  },

  // --- Financial services --------------------------------------------------
  {
    id: "finance.banking",
    sector: "Financial Services",
    category: "Banking & Credit Unions",
    naicsHint: "522",
    schemaTypes: ["BankOrCreditUnion"],
    keywords: ["savings account", "current account", "checking account", "debit card", "credit card", "net banking", "branch", "ifsc", "routing number", "fixed deposit", "overdraft"],
  },
  {
    id: "finance.brokerage_investing",
    sector: "Financial Services",
    category: "Brokerage & Investing",
    naicsHint: "523",
    keywords: ["brokerage", "trading account", "demat", "mutual funds", "portfolio", "equities", "derivatives", "etf", "stocks", "invest", "sip", "wealth management", "brokerage fee"],
  },
  {
    id: "finance.lending",
    sector: "Financial Services",
    category: "Lending & Mortgages",
    naicsHint: "522",
    schemaTypes: ["LoanOrCredit"],
    keywords: ["personal loan", "home loan", "mortgage", "interest rate", "emi", "apr", "loan eligibility", "credit score", "refinance", "collateral"],
  },
  {
    id: "finance.insurance",
    sector: "Financial Services",
    category: "Insurance",
    naicsHint: "524",
    schemaTypes: ["InsuranceAgency"],
    keywords: ["premium", "policy", "coverage", "claim", "insured", "term life", "health insurance", "motor insurance", "deductible", "underwriting"],
  },
  {
    id: "finance.payments_fintech",
    sector: "Financial Services",
    category: "Payments & Fintech Infrastructure",
    keywords: ["payment gateway", "checkout api", "merchant account", "transaction fees", "payouts", "settlement", "kyc", "pci dss", "upi", "wallet"],
  },

  // --- Healthcare ----------------------------------------------------------
  {
    id: "healthcare.hospital_clinical",
    sector: "Healthcare",
    category: "Hospitals & Clinical Care",
    naicsHint: "622",
    schemaTypes: ["Hospital", "MedicalClinic", "MedicalOrganization", "Physician"],
    keywords: ["patients", "specialities", "specialties", "cardiology", "oncology", "orthopaedics", "orthopedics", "neurology", "paediatrics", "pediatrics", "emergency care", "book an appointment", "consultant", "diagnosis", "surgery", "icu", "outpatient", "inpatient"],
  },
  {
    id: "healthcare.dental_specialty",
    sector: "Healthcare",
    category: "Dental & Specialty Clinics",
    schemaTypes: ["Dentist", "Optician", "Physiotherapy"],
    keywords: ["dental", "orthodontic", "implants", "root canal", "teeth whitening", "physiotherapy", "chiropractic", "optometry", "eye test", "hearing aid"],
  },
  {
    id: "healthcare.pharma_devices",
    sector: "Healthcare",
    category: "Pharmaceuticals & Medical Devices",
    naicsHint: "3254 / 3391",
    schemaTypes: ["Pharmacy", "Drug"],
    keywords: ["prescription", "pharmaceutical", "clinical trial", "fda approved", "medical device", "dosage", "formulation", "api manufacturing", "regulatory approval"],
  },
  {
    id: "healthcare.wellness_fitness",
    sector: "Healthcare",
    category: "Fitness & Wellness",
    naicsHint: "713",
    schemaTypes: ["HealthClub", "Gym", "SportsActivityLocation", "DaySpa"],
    keywords: ["membership", "personal training", "class schedule", "yoga", "pilates", "reformer", "spa", "massage", "wellness", "workout"],
  },

  // --- Hospitality, food and travel ---------------------------------------
  {
    id: "hospitality.hotels",
    sector: "Hospitality",
    category: "Hotels & Resorts",
    naicsHint: "721",
    schemaTypes: ["Hotel", "LodgingBusiness", "Resort", "BedAndBreakfast"],
    keywords: ["book a room", "check-in", "check-out", "suite", "amenities", "nightly rate", "guests", "spa", "resort", "concierge", "rooms & suites"],
  },
  {
    id: "hospitality.restaurants",
    sector: "Hospitality",
    category: "Restaurants & Food Service",
    naicsHint: "722",
    schemaTypes: ["Restaurant", "FoodEstablishment", "CafeOrCoffeeShop", "FastFoodRestaurant", "BarOrPub"],
    keywords: ["menu", "reservation", "dine-in", "takeaway", "takeout", "delivery", "starters", "mains", "desserts", "chef", "cuisine", "order online", "table for"],
  },
  {
    id: "travel.agency_ota",
    sector: "Travel",
    category: "Travel Booking & Tour Operators",
    naicsHint: "5615",
    schemaTypes: ["TravelAgency", "TouristTrip"],
    keywords: ["itinerary", "flights", "holiday packages", "tour", "destinations", "book your trip", "travel insurance", "visa", "excursion", "cruise"],
  },

  // --- Education -----------------------------------------------------------
  {
    id: "education.schools_universities",
    sector: "Education",
    category: "Schools & Universities",
    naicsHint: "611",
    schemaTypes: ["EducationalOrganization", "CollegeOrUniversity", "School", "Preschool"],
    keywords: ["admissions", "curriculum", "campus", "faculty", "tuition", "undergraduate", "postgraduate", "degree", "students", "academic year", "alumni", "scholarship"],
  },
  {
    id: "education.training_edtech",
    sector: "Education",
    category: "Professional Training & EdTech",
    naicsHint: "6114",
    schemaTypes: ["Course", "LearningResource"],
    keywords: ["enroll", "online course", "certification", "bootcamp", "learning path", "instructor", "cohort", "syllabus", "upskill", "self-paced"],
  },

  // --- Industrial ----------------------------------------------------------
  {
    id: "industrial.manufacturing",
    sector: "Manufacturing",
    category: "Industrial Manufacturing",
    naicsHint: "31-33",
    keywords: ["manufacturing", "production capacity", "iso 9001", "oem", "tolerance", "machining", "fabrication", "assembly line", "supply chain", "raw materials", "plant", "industrial", "components", "bulk orders", "moq"],
  },
  {
    id: "industrial.construction_realestate",
    sector: "Construction & Real Estate",
    category: "Construction & Property Development",
    naicsHint: "23 / 531",
    schemaTypes: ["RealEstateAgent", "HomeAndConstructionBusiness", "GeneralContractor"],
    keywords: ["square feet", "sq ft", "floor plan", "possession", "apartments", "villas", "commercial space", "contractor", "civil works", "rera", "property for sale", "real estate", "under construction"],
  },
  {
    id: "logistics.transport",
    sector: "Logistics",
    category: "Logistics & Transportation",
    naicsHint: "48-49",
    schemaTypes: ["MovingCompany", "DeliveryService"],
    keywords: ["freight", "shipment", "warehousing", "last mile", "fleet", "tracking number", "customs", "3pl", "logistics", "courier", "cargo", "supply chain visibility"],
  },
  {
    id: "energy.utilities",
    sector: "Energy & Utilities",
    category: "Energy, Solar & Utilities",
    naicsHint: "22",
    keywords: ["solar", "kilowatt", "renewable", "grid", "energy efficiency", "installation", "battery storage", "power plant", "utility bill", "megawatt"],
  },

  // --- Professional and local services ------------------------------------
  {
    id: "services.professional",
    sector: "Professional Services",
    category: "Consulting & Professional Services",
    naicsHint: "5416",
    schemaTypes: ["ProfessionalService", "AccountingService"],
    keywords: ["our clients", "case studies", "engagement model", "advisory", "audit", "accounting", "tax advisory", "consulting", "our expertise", "our approach", "deliverables"],
  },
  {
    id: "services.legal",
    sector: "Professional Services",
    category: "Legal Services",
    naicsHint: "5411",
    schemaTypes: ["LegalService", "Attorney", "Notary"],
    keywords: ["attorney", "solicitor", "advocate", "litigation", "legal advice", "practice areas", "counsel", "case", "law firm", "bar council"],
  },
  {
    id: "services.marketing_agency",
    sector: "Professional Services",
    category: "Marketing & Creative Agencies",
    naicsHint: "5418",
    keywords: ["seo", "paid media", "brand strategy", "ad campaign", "creative agency", "our work", "content marketing", "social media management", "media buying"],
  },
  {
    id: "services.local_trades",
    sector: "Local Services",
    category: "Home & Trade Services",
    naicsHint: "238 / 811",
    schemaTypes: ["Plumber", "Electrician", "HVACBusiness", "RoofingContractor", "Locksmith", "MovingCompany", "AutoRepair"],
    keywords: ["get a free quote", "service area", "licensed and insured", "emergency service", "same day", "call us today", "repair", "installation", "maintenance", "24/7", "no call-out fee"],
  },
  {
    id: "services.personal_care",
    sector: "Local Services",
    category: "Salons & Personal Care Services",
    schemaTypes: ["BeautySalon", "HairSalon", "NailSalon", "TattooParlor"],
    keywords: ["salon", "haircut", "colouring", "coloring", "manicure", "pedicure", "book your appointment", "stylist", "treatments menu"],
  },

  // --- Platforms, media, non-profit ---------------------------------------
  {
    id: "platform.marketplace",
    sector: "Marketplaces & Platforms",
    category: "Online Marketplace",
    // A marketplace is defined by inviting THIRD PARTIES TO SELL, not by
    // mentioning buyers, vendors or partners. The bare nouns fired on any B2B
    // site with an app directory or partner programme — they classified a CRM
    // vendor as an online marketplace, which then chose the wrong archetype
    // weights, topic templates and trade-off criteria for the whole run.
    keywords: ["become a seller", "sell on", "start selling", "seller central", "verified sellers", "list your", "listing fee", "seller fees", "commission", "marketplace", "browse listings", "buy and sell"],
  },
  {
    id: "media.publishing",
    sector: "Media",
    category: "Media & Publishing",
    naicsHint: "513",
    schemaTypes: ["NewsMediaOrganization", "Blog"],
    keywords: ["latest news", "editorial team", "our writers", "breaking news", "opinion", "newsroom", "podcast episode", "our columnists"],
  },
  {
    id: "nonprofit.charity",
    sector: "Non-profit",
    category: "Non-profit & Advocacy",
    naicsHint: "813",
    schemaTypes: ["NGO", "Charity"],
    keywords: ["donate", "our mission", "volunteer", "beneficiaries", "fundraising", "charity", "impact report", "registered charity", "ngo"],
  },
  {
    id: "telecom.services",
    sector: "Telecommunications",
    category: "Telecom & Connectivity",
    naicsHint: "517",
    keywords: ["broadband", "fibre", "fiber", "mobile plans", "data pack", "coverage map", "sim", "5g", "postpaid", "prepaid", "bundle"],
  },
  {
    id: "agriculture.food_production",
    sector: "Agriculture",
    category: "Agriculture & Food Production",
    naicsHint: "11",
    keywords: ["farm", "harvest", "crop", "livestock", "agri", "irrigation", "yield", "seeds", "fertiliser", "fertilizer", "dairy"],
  },
];

export const INDUSTRY_BY_ID = new Map(INDUSTRY_TAXONOMY.map((c) => [c.id, c]));

export function industryLabel(id: string): string {
  const entry = INDUSTRY_BY_ID.get(id);
  return entry ? `${entry.sector} — ${entry.category}` : id;
}

// --- Business archetype ----------------------------------------------------
//
// Archetype is a different axis from industry: an athletic brand and a
// bookshop are both "Ecommerce / Consumer Brand", while an automotive
// manufacturer and a local dealership share the Automotive sector but behave
// nothing alike. Keeping them separate is what stops the classifier from
// having to choose between "what it sells" and "how it sells".

export const ARCHETYPE_LABELS: Record<string, string> = {
  b2b_saas_enterprise: "B2B SaaS / Software Vendor",
  ecommerce_dtc_retail: "Ecommerce / Consumer Brand",
  local_service: "Local Service Business",
  dealership: "Local Dealership / Reseller",
  restaurant_food_chain: "Restaurant / Food Service",
  multi_location_chain: "Multi-location Chain",
  healthcare: "Healthcare Provider",
  finance: "Financial Institution",
  marketplace: "Marketplace / Platform",
  travel_hospitality: "Travel & Hospitality",
  education: "Education Provider",
  other: "Other",
};
