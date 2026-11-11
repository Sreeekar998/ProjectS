import { redirect } from "next/navigation";

/**
 * Retired route.
 *
 * Evidence collection is no longer a stage in the journey — it happens inside
 * Measure. This redirect keeps older links and bookmarks working instead of
 * 404ing them.
 */
export default async function RetiredCollectRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/measure`);
}
