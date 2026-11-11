import { RouteLoading } from "@/components/features/route-loading";
import { LandscapeSkeleton } from "@/components/features/stage-skeletons";

export default function Loading() {
  return (
    <RouteLoading stage="landscape" title="Topics & competitors" width="max-w-4xl">
      <LandscapeSkeleton />
    </RouteLoading>
  );
}
