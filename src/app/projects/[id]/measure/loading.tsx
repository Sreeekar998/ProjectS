"use client";

import { useParams } from "next/navigation";
import { MeasureSkeleton } from "@/components/features/stage-skeletons";

// loading.tsx receives no params, so the project id comes from the URL.
export default function Loading() {
  const { id } = useParams<{ id: string }>();
  return <MeasureSkeleton projectId={id} />;
}
