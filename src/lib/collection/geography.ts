// Observation geography.
//
// Two different facts wear the word "geography" and conflating them produces a
// claim we cannot support:
//
//   INTENDED MARKET      the market the prompt is ABOUT ("best running shoes
//                        in UAE"). A property of the approved prompt.
//
//   EXECUTION ORIGIN     where the observation was PHYSICALLY made. A property
//                        of the operator's machine and network.
//
// A UAE prompt asked from Bengaluru is a perfectly legitimate observation, but
// it is not a UAE observation, and reporting it as one would be fabricating
// geographic execution. Peec AI's published approach is the opposite end of
// this trade: dedicated infrastructure in 80+ countries so execution origin
// genuinely matches the market, rather than injecting a country name into the
// prompt. Project Sun cannot reproduce that at zero cost, so it records the
// difference instead of hiding it.

/** How we came to believe the execution origin. Never inferred silently. */
export type ExecutionOriginSource =
  | "operator_declared" // the operator told us where they were
  | "unknown"; // not asserted — the honest default
