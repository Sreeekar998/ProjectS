import { NextResponse } from "next/server";
import { INDUSTRY_TAXONOMY, industryLabel } from "@/lib/profile/taxonomy";

/** The closed industry vocabulary, for the review screen's industry selector. */
export async function GET() {
  const industries = INDUSTRY_TAXONOMY.map((category) => ({
    id: category.id,
    sector: category.sector,
    category: category.category,
    label: industryLabel(category.id),
  })).sort((a, b) => a.sector.localeCompare(b.sector) || a.category.localeCompare(b.category));
  return NextResponse.json({ industries });
}
