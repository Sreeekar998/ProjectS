import { describe, expect, it } from "vitest";
import { buildLinkTargets, detectEmergingCandidates, detectMentions } from "@/lib/analysis/mentions";
import type { Entity } from "@/lib/landscape/repository";

// A Dubai gym's answers listed JVC, Dubai Marina, Al Quoz and Nakheel Mall as
// untracked "brands", with "CrossFit-style", "Motor City. A", "Wednesday" and
// "AED" beside the real rivals (feedback 2026-09-16). With the project's
// places and category words, only businesses of the measured kind remain.
const answer = [
  "If you want coached strength classes in Dubai, these are the gyms people rate:",
  "",
  "1. **Origin Fit** – a boutique gym in Al Quoz with small-group strength coaching, from AED 250 a month.",
  "2. **MH3 Gym** – near Business Bay, known for CrossFit-style classes on Wednesday and Friday evenings.",
  "3. **GymNation** – budget chain with branches in Dubai Marina, JVC and Motor City. A day pass is cheap.",
  "4. **Fitness First** – large chain at Nakheel Mall and Dubai Silicon Oasis with classes all week.",
  "",
  "The Warehouse Gym in Umm Suqeim is another option, as is Kids Unlimited for children. Trainers in DIFC charge more; Athleaders UAE lists personal trainers across the city.",
  "Multiple Dubai studios also run Olympic lifting. [AE Profile](https://ae-profile.com/gyms) shows Dedicated coaches near Jumeirah Park.",
].join("\n");

const context = {
  places: ["Dubai", "United Arab Emirates", "Al Quoz", "Jumeirah Village Circle", "JVC", "Umm Suqeim", "Business Bay", "Dubai Marina"],
  categoryTerms: ["gym", "gyms", "fitness", "studio", "studios", "classes", "class", "strength", "crossfit", "training", "trainer", "trainers", "coaching", "coaches", "membership"],
};

describe("untracked names with the project's places and category", () => {
  const names = detectEmergingCandidates(answer, [], context).map((candidate) => candidate.name);

  it("keeps businesses of the measured kind", () => {
    for (const name of ["Origin Fit", "MH3 Gym", "GymNation", "Fitness First", "Kids Unlimited", "Athleaders"]) expect(names).toContain(name);
  });

  it("drops places, whether known, shaped like one, or only ever after a preposition", () => {
    for (const name of ["Al Quoz", "Business Bay", "Dubai Marina", "JVC", "Motor City", "Nakheel Mall", "Dubai Silicon Oasis", "Umm Suqeim", "Jumeirah Park", "DIFC", "Dubai"]) expect(names).not.toContain(name);
  });

  it("drops sentence fragments, qualifiers, weekdays and currencies", () => {
    for (const name of ["CrossFit-style", "CrossFit", "Motor City. A", "Wednesday", "Friday", "AED", "Multiple Dubai", "Dedicated", "Olympic", "AE Profile", "Trainers"]) expect(names).not.toContain(name);
  });

  it("drops cited source sites, landmarks in place lists, dash descriptions and things listed among lower-case words", () => {
    const text = [
      "* **GymNation Downtown Dubai** — Convenient if you're around Downtown/Burj Khalifa; open 24/7. [Dubai Visitor Visa](https://dubaivisitorvisa.example/gyms)",
      "* **iGym: Gymnastics for Kids** — Palm Jumeirah/Nakheel Mall; another iGym location.",
      "* Warehouse Gym - Jumeirah Park — Opens **5:30 AM weekdays**, another option for early gym sessions.",
      "* Athleaders Global Dubai — offers a trainer plus nutrition plan, from AED 305 a session. [Athleaders UAE](https://athleaders.ae/booking/)",
      "GymNation is commonly listed around **AED 99–199/month** for gym membership. [AE Profile](https://ae-profile.com/blog/gym-prices)",
      "Members praise the functional-training areas of the gym. [FitFit](https://gymfinder.ae/en/i/394-the-warehouse-gym)",
      "The gym currently lists branches across Al Quoz, DIFC, Business Bay, Springs Souk, Ibn Battuta and Al Khawaneej.",
      "For hybrid training, EMD Fitness is built around strength & conditioning, boxing, HYROX and performance training in its gym.",
      "Kids Unlimited UAE",
      "",
      "4.8•Fitness center",
      "",
      "Open",
      "",
      "GymNation Bur Dubai | Best Gym In Bur Dubai",
      "",
      "4.4",
    ].join("\n");
    const found = detectEmergingCandidates(text, [], context).map((candidate) => candidate.name);
    for (const name of ["Athleaders Global", "Kids Unlimited", "EMD Fitness", "GymNation"]) expect(found).toContain(name);
    expect(found).not.toContain("GymNation Downtown");
    for (const name of ["Burj Khalifa", "Palm Jumeirah", "Nakheel Mall", "Ibn Battuta", "Springs Souk", "Al Khawaneej", "Opens", "Convenient", "AE Profile", "FitFit", "Dubai Visitor Visa", "HYROX", "Athleaders UAE", "Kids Unlimited UAE", "GymNation Bur", "GymNation Bur Dubai"]) expect(found).not.toContain(name);
  });

  it("folds short forms into the longer name and the tracked business's own forms into nothing", () => {
    const text = "Gold's Gym in Al Quoz is popular; Gold's also runs classes. MH3 Gym and MH3 both mean the same box gym. Origin Fit is smaller, though Origin has good coaches. Warehouse CrossFit and Warehouse's PT are the gym's own programmes, and Warehouse has many branches.";
    const found = detectEmergingCandidates(text, [], { ...context, trackedNames: ["The Warehouse Gym"] }).map((candidate) => candidate.name);
    expect(found).toContain("Gold's Gym");
    expect(found).toContain("MH3 Gym");
    expect(found).toContain("Origin Fit");
    for (const name of ["Gold's", "MH3", "Origin", "Warehouse", "Warehouse CrossFit", "Warehouse's PT"]) expect(found).not.toContain(name);
  });

  it("for a global brand drops product lines, models, athletes, technologies and shopping channels but keeps rival brands", () => {
    const nike = { id: "ent_nike", projectId: "p", canonicalName: "Nike", canonicalDomain: "nike.com", domains: [], entityType: "company", status: "confirmed", parentEntityId: null } as unknown as Entity;
    const targets = buildLinkTargets([nike], new Map());
    const text = [
      "For daily miles the Nike Pegasus 40 is the safe pick, though Pegasus feels firmer than the Vaporfly 3; ZoomX foam and Dri-FIT fabric are Nike's own technologies.",
      "Brands like Hoka, Brooks and Saucony make softer trainers, and Adidas or New Balance fit wider feet. LeBron James and Cristiano Ronaldo are Nike athletes with signature shoe lines.",
      "You can buy from Zappos, via Myntra or on Amazon; Italian brands such as Diadora suit narrow feet, and Black Friday deals cut prices. Running Apparel from Lululemon is pricier. See the Help Center for Shipping Policies.",
      "**Cost:** Under Armour undercuts most rivals on running shoes. APIs and PRs are not shoes.",
    ].join("\n");
    const shoeContext = { places: ["United States"], categoryTerms: ["running", "shoes", "sneakers", "trainers", "apparel", "sportswear", "footwear", "brand", "brands", "athletic"] };
    const mentions = detectMentions(text, targets);
    const found = detectEmergingCandidates(text, mentions, { ...shoeContext, trackedNames: ["Nike"] }).map((candidate) => candidate.name);
    for (const name of ["Hoka", "Brooks", "Saucony", "Adidas", "New Balance", "Diadora", "Lululemon", "Under Armour"]) expect(found).toContain(name);
    for (const name of ["Pegasus", "Vaporfly", "ZoomX", "Dri-FIT", "LeBron James", "Cristiano Ronaldo", "Zappos", "Myntra", "Amazon", "Italian", "Black Friday", "Running Apparel", "Help Center", "Shipping Policies", "Cost", "APIs", "PRs"]) expect(found).not.toContain(name);
  });

  it("for a restaurant drops neighbourhoods, cuisines, dishes and file names but keeps other restaurants", () => {
    const text = [
      "Truffles in Koramangala is the burger benchmark, and its Indiranagar branch is quieter. For South Indian food, Mavalli Tiffin Rooms and CTR Shri Sagar are the Bengaluru classics.",
      "For thalis, Rajdhani serves Gujarati food, while Chicken Biryani and Mutton Rogan Josh are the draws at Nandhana Palace; Leon's Burgers competes on price. The menu is at EmpireMenu.pdf and Marathahalli has no outlet.",
    ].join("\n");
    const foodContext = { places: ["India", "Bengaluru", "Koramangala"], categoryTerms: ["restaurant", "restaurants", "burger", "burgers", "biryani", "chicken", "mutton", "thali", "thalis", "food", "menu", "dining", "tiffin", "classics"] };
    const found = detectEmergingCandidates(text, [], foodContext).map((candidate) => candidate.name);
    for (const name of ["Mavalli Tiffin Rooms", "CTR Shri Sagar", "Rajdhani", "Nandhana Palace", "Leon's Burgers"]) expect(found).toContain(name);
    for (const name of ["Koramangala", "Indiranagar", "South Indian", "Gujarati", "Chicken Biryani", "Mutton Rogan Josh", "EmpireMenu.pdf", "Marathahalli", "Bengaluru"]) expect(found).not.toContain(name);
  });

  it("for a software product keeps rival tools but drops examples the answer asks about, channels, jargon, flow steps, features and modules", () => {
    const pipedrive = { id: "ent_pd", projectId: "p", canonicalName: "Pipedrive", canonicalDomain: "pipedrive.com", domains: [], entityType: "company", status: "confirmed", parentEntityId: null } as unknown as Entity;
    const targets = buildLinkTargets([pipedrive], new Map());
    const text = [
      "| CRM | Good fit for | Notable strength |",
      "| --- | --- | --- |",
      "| [HubSpot Sales Hub](https://www.hubspot.com/products/sales) | Small teams | Free CRM tier |",
      "| [Mailchimp](https://mailchimp.com) | Beginners | Easy setup |",
      "| Insightly | Professional services firms | Built around linking customers to projects |",
      "| **Salesforce** | More extensive lead management, automation and scoring |",
      "",
      "HubSpot is the closest all-in-one rival; teams that outgrow Pipedrive often compare HubSpot, Salesforce and Close CRM software. Zapier/automation platforms fill the gaps.",
      "* **Source tracking:** know whether a lead came from Google Ads, Facebook, referral, etc.",
      "* Pipedrive + Slack",
      "A sales pipeline runs New lead → Contacted → Demo → Proposal → Won/Lost, with a custom “Lead Source” field and CRM-linked campaigns; support sits in the Quick Help menu, and leads land in the Leads Inbox.",
      "If you tell me what tools you need to connect (e.g., Gmail, Outlook, QuickBooks, Shopify), whether you do B2B/B2C and your business type (agency, SaaS, consulting), I can narrow this CRM software shortlist to 2–3 options. [CRM Compared](https://crmcompared.com/compare/pipedrive-vs-hubspot/)",
    ].join("\n");
    const saasContext = { places: ["Worldwide", "United States"], categoryTerms: ["crm", "software", "tool", "tools", "platform", "platforms", "sales", "pipeline", "lead", "leads", "automation", "marketing", "email"] };
    const mentions = detectMentions(text, targets);
    const found = detectEmergingCandidates(text, mentions, { ...saasContext, trackedNames: ["Pipedrive"] }).map((candidate) => candidate.name);
    for (const name of ["HubSpot", "Mailchimp", "Insightly", "Salesforce"]) expect(found).toContain(name);
    expect(found.some((name) => name === "Close" || name === "Close CRM")).toBe(true);
    for (const name of ["HubSpot Sales Hub", "Facebook", "Google Ads", "Gmail", "Outlook", "QuickBooks", "Shopify", "B2B", "B2C", "SaaS", "Slack", "Zapier", "Won", "Lost", "Proposal", "Contacted", "Lead Source", "Quick Help", "CRM-linked", "Leads Inbox", "CRM Compared", "New"]) expect(found).not.toContain(name);
  });

  it("without a context keeps the older behaviour for single-word brands", () => {
    const plain = detectEmergingCandidates("For daily miles I rotate between Hoka and my old shoes; Hoka feels softer.", []).map((candidate) => candidate.name);
    expect(plain).toEqual(["Hoka"]);
  });
});
