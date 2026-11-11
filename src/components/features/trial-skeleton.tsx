import { Skeleton } from "@/components/ui/loading-stage";

// Placeholder for the intake page while its route loads. It mirrors the real
// layout (brand row, heading, the form's rows, the side rail) so nothing jumps
// when the form appears. No real labels: the skeleton must not read as a form
// the operator can already fill in.

export function TrialSkeleton() {
  return (
    <main className="min-h-screen" aria-busy="true">
      <div role="status" aria-label="Loading the analysis form" className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-14" />
        </div>
        <div className="mt-8 grid gap-10 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16">
          <div className="max-w-xl">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="mt-3 h-8 w-64 rounded-lg" />
            <Skeleton className="mt-3 h-3.5 w-full" />
            <Skeleton className="mt-1.5 h-3.5 w-3/4" />
            <div className="sun-sheet mt-6 space-y-5 p-5 sm:p-6">
              {/* Website */}
              <div>
                <Skeleton className="mb-2 h-3.5 w-16" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
              {/* Where are your customers? */}
              <div className="border-t border-ink-100 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-11 w-full rounded-lg sm:h-10" />
                <Skeleton className="mt-2 h-3 w-full" />
                <Skeleton className="mt-1.5 h-3 w-2/3" />
              </div>
              {/* Search Console */}
              <div className="border-t border-ink-100 pt-4">
                <div className="flex items-center justify-between gap-4">
                  <Skeleton className="h-3.5 w-44" />
                  <Skeleton className="h-6 w-11 rounded-full" />
                </div>
                <Skeleton className="mt-2 h-3 w-4/5" />
              </div>
              {/* Button and footnote */}
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="mx-auto h-3 w-3/4" />
            </div>
          </div>
          <div className="hidden lg:block">
            <Skeleton className="h-80 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </main>
  );
}
