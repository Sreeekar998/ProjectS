import { RouteLoading } from "@/components/features/route-loading";
import { PromptsSkeleton } from "@/components/features/stage-skeletons";

export default function Loading() {
  return (
    <RouteLoading stage="prompts" title="Prompt Intelligence" width="max-w-5xl">
      <PromptsSkeleton />
    </RouteLoading>
  );
}
