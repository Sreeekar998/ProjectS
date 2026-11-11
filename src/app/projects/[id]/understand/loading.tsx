import { RouteLoading } from "@/components/features/route-loading";
import { ProfileSkeleton } from "@/components/features/stage-skeletons";

export default function Loading() {
  return (
    <RouteLoading stage="understand" title="Your brand profile" width="max-w-3xl">
      <ProfileSkeleton />
    </RouteLoading>
  );
}
