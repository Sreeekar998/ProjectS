import Link from "next/link";
import { WebsiteStartForm } from "@/components/marketing/website-start-form";

function Eyebrow({ children, inverted = false }: { children: React.ReactNode; inverted?: boolean }) {
  return <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${inverted ? "text-sun-300" : "text-sun-700"}`}>{children}</div>;
}

function SectionIntro({ eyebrow, title, body, centered = false }: { eyebrow: string; title: string; body: string; centered?: boolean }) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-2xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] text-ink-950 sm:text-5xl">{title}</h2>
      <p className={`mt-5 text-lg leading-8 text-ink-500 ${centered ? "mx-auto max-w-2xl" : ""}`}>{body}</p>
    </div>
  );
}

export function SearchShiftSection() {
  return (
    <section id="product" className="scroll-mt-20 border-b border-ink-100 bg-ink-50/60 py-24 sm:py-32">
      <div className="mx-auto max-w-[1180px] px-6 lg:px-10">
        <SectionIntro eyebrow="A new discovery layer" title="Search no longer ends with a list of links." body="Buyers ask complete questions and receive synthesized answers. The result may recommend brands, compare providers, and cite sources before a buyer ever reaches a website." centered />
        <div className="mt-14 grid overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-[0_24px_70px_-50px_rgba(15,23,42,0.5)] lg:grid-cols-2">
          <div className="border-b border-ink-100 p-7 sm:p-10 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between">
              <div><div className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-400">Traditional search</div><h3 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">A query returns ranked links</h3></div>
              <span className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-500">Known model</span>
            </div>
            <div className="mt-9 rounded-xl border border-ink-200 bg-ink-50 p-4">
              <div className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white px-4 py-3 text-sm text-ink-600"><span className="h-3 w-3 rounded-full border-2 border-ink-300" />best family dentist near me</div>
              <div className="mt-4 space-y-3">
                {["Clinic website", "Directory result", "Review article"].map((item, index) => <div key={item} className="flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-md bg-white text-xs text-ink-400">{index + 1}</span><div className="h-2.5 rounded-full bg-ink-200" style={{ width: `${72 - index * 12}%` }} /><span className="ml-auto text-xs text-ink-300">link</span></div>)}
              </div>
            </div>
          </div>
          <div className="bg-[#101722] p-7 text-white sm:p-10">
            <div className="flex items-center justify-between">
              <div><div className="text-xs font-semibold uppercase tracking-[0.15em] text-sun-300">AI search</div><h3 className="mt-2 text-2xl font-semibold tracking-tight">A question becomes an answer</h3></div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/50">New model</span>
            </div>
            <div className="mt-9 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-[0.13em] text-white/35">Buyer question</div>
              <p className="mt-2 text-sm leading-6 text-white/80">Which family dentists nearby offer evening appointments and are highly rated?</p>
              <div className="my-4 h-px bg-white/10" />
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 text-xs text-white/60">
                <span className="text-sun-300">01</span><span>Synthesized recommendation</span>
                <span className="text-sun-300">02</span><span>Named brands and comparisons</span>
                <span className="text-sun-300">03</span><span>Sources, when the route exposes them</span>
              </div>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-9 max-w-3xl text-center text-xl font-medium leading-8 text-ink-800">The question for marketing teams is simple: when buyers ask, does the answer mention you, your competitors—or neither?</p>
      </div>
    </section>
  );
}

const WORKFLOW = [
  ["01", "Understand your business", "Build an evidence-backed view of your offerings, audience, market, and geography from the website you submit."],
  ["02", "Discover what buyers ask", "Translate confirmed business context into topics, use cases, competitors, and realistic buyer questions."],
  ["03", "Build the prompt set", "Validate, deduplicate, and select a balanced measurement cohort—not an arbitrary keyword list."],
  ["04", "Collect the answers", "Each approved question is asked on the assistant's own website in a signed-out browser session, and the answer keeps its sources, time and provenance."],
  ["05", "Measure what happened", "Report how often the brand is recommended, share of voice, rank, head-to-head verdicts, reputation and citations, every figure as x of n."],
] as const;

export function WorkflowSection() {
  return (
    <section id="how-it-works" className="scroll-mt-20 bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-6 lg:px-10">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <SectionIntro eyebrow="How Project Sun works" title="From your website to a defensible measurement." body="Each stage keeps the next one grounded. You review what Project Sun understands before it defines your market or measures your visibility." />
          <div className="max-w-sm rounded-xl border border-sun-200 bg-sun-50 p-4 text-sm leading-6 text-sun-900"><span className="font-semibold">Phase 2 focus: Measure.</span> The current product establishes the observation and evidence layer without claiming future Diagnose or Act features are already live.</div>
        </div>
        <div className="relative mt-16">
          <div className="absolute left-5 top-5 hidden h-px w-[calc(100%-2.5rem)] bg-ink-200 lg:block" />
          <ol className="grid gap-7 lg:grid-cols-5 lg:gap-5">
            {WORKFLOW.map(([number, title, body], index) => (
              <li key={number} className="relative grid grid-cols-[auto_1fr] gap-4 lg:block">
                <span className={`relative z-10 grid h-11 w-11 place-items-center rounded-full border text-xs font-semibold ${index === 4 ? "border-sun-500 bg-sun-400 text-ink-950" : "border-ink-200 bg-white text-ink-500"}`}>{number}</span>
                <div className="lg:mt-6"><h3 className="text-lg font-semibold tracking-tight text-ink-900">{title}</h3><p className="mt-2 text-sm leading-6 text-ink-500">{body}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function PromptIntelligenceSection() {
  return (
    <section className="border-y border-ink-100 bg-[#f8fafc] py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-10">
        <div>
          <Eyebrow>Prompt intelligence</Eyebrow>
          <h2 className="mt-4 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] text-ink-950 sm:text-5xl">Measure buyer questions, not invented keywords.</h2>
          <p className="mt-5 text-lg leading-8 text-ink-500">Project Sun builds prompts from the business context you approve. It balances topic, intent, persona, geography, and prompt type, then checks every candidate for quality and overlap.</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            <div className="border-l-2 border-sun-400 pl-4"><div className="font-semibold text-ink-900">Neutral discovery</div><p className="mt-1 text-sm leading-6 text-ink-500">Category and problem questions generated without target-brand leakage.</p></div>
            <div className="border-l-2 border-ink-300 pl-4"><div className="font-semibold text-ink-900">Brand-aware review</div><p className="mt-1 text-sm leading-6 text-ink-500">Separate prompts inspect direct brand and comparison answers without contaminating Presence or Share of Voice.</p></div>
          </div>
        </div>
        <PromptReviewVisual />
      </div>
    </section>
  );
}

function PromptReviewVisual() {
  const prompts = [
    ["What are the best inventory tools for independent retailers?", "Evaluation", "Retail owner", "Global", "Neutral"],
    ["How can a multi-location clinic keep appointment information consistent?", "Problem", "Operations", "UAE", "Neutral"],
    ["How does Demo Brand compare with other reporting platforms?", "Comparison", "Marketing lead", "Global", "Brand-aware"],
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-[0_28px_80px_-55px_rgba(15,23,42,0.55)]" aria-label="Illustrative prompt review interface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4"><div><div className="text-sm font-semibold text-ink-900">Measurement prompt set</div><div className="mt-0.5 text-xs text-ink-400">Illustrative review</div></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">30 / 30 selected</span></div>
      <div className="grid gap-px bg-ink-100 sm:grid-cols-4">
        {[["Generated", "112"], ["Validated", "86"], ["Duplicates", "11"], ["Selected", "30"]].map(([label, value]) => <div key={label} className="bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div><div className="mt-1 text-xl font-semibold text-ink-900">{value}</div></div>)}
      </div>
      <div className="p-4 sm:p-5">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-sun-50 px-3 py-2"><div className="text-lg font-semibold text-sun-900">10</div><div className="text-[11px] text-sun-700">Discovery</div></div>
          <div className="rounded-lg bg-ink-50 px-3 py-2"><div className="text-lg font-semibold text-ink-900">10</div><div className="text-[11px] text-ink-500">Trade Offs</div></div>
          <div className="rounded-lg bg-ink-50 px-3 py-2"><div className="text-lg font-semibold text-ink-900">10</div><div className="text-[11px] text-ink-500">Reputation</div></div>
        </div>
        <div className="space-y-2.5">
          {prompts.map(([text, intent, persona, geography, type]) => <div key={text} className="rounded-xl border border-ink-100 p-3.5"><div className="flex gap-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" /><div className="min-w-0"><p className="text-sm font-medium leading-5 text-ink-800">{text}</p><div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-ink-500">{[intent, persona, geography].map(tag => <span key={tag} className="rounded-md bg-ink-50 px-2 py-1">{tag}</span>)}<span className={`rounded-md px-2 py-1 ${type === "Neutral" ? "bg-sun-50 text-sun-800" : "bg-brand-50 text-brand-600"}`}>{type}</span></div></div></div></div>)}
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-ink-400"><span>Coverage gates passed</span><span>Review before measurement →</span></div>
      </div>
    </div>
  );
}

export function MeasurementSection() {
  return (
    <section id="visibility" className="scroll-mt-20 bg-white py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
        <MeasurementVisual />
        <div>
          <Eyebrow>Competitive measurement</Eyebrow>
          <h2 className="mt-4 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] text-ink-950 sm:text-5xl">See who appears when your buyers ask.</h2>
          <p className="mt-5 text-lg leading-8 text-ink-500">Named unprompted tells you whether the brand is named at all. Share of every business named compares those mentions with every business the answers named. Engine views show where the picture changes.</p>
          <ul className="mt-8 space-y-4 text-sm leading-6 text-ink-600">
            <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sun-500" /><span><strong className="font-semibold text-ink-900">Known denominator.</strong> Metrics state which eligible observations and tracked brands they use.</span></li>
            <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sun-500" /><span><strong className="font-semibold text-ink-900">Provider context.</strong> ChatGPT and Gemini observations remain identifiable rather than collapsing into an unexplained score.</span></li>
            <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sun-500" /><span><strong className="font-semibold text-ink-900">Meaningful position only.</strong> Rank is reported when an answer contains an ordered or recommendation structure—not guessed from prose.</span></li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function MeasurementVisual() {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-[#111827] p-5 text-white shadow-[0_28px_80px_-55px_rgba(15,23,42,0.7)] sm:p-6" aria-label="Illustrative competitive measurement chart">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold">Competitive presence</div><div className="mt-1 text-xs text-white/40">Illustrative neutral cohort</div></div><div className="flex gap-1.5 text-[11px]"><span className="rounded-full bg-white/10 px-2.5 py-1 text-white/70">All providers</span><span className="rounded-full border border-white/10 px-2.5 py-1 text-white/40">26 eligible</span></div></div>
      <div className="mt-8 grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-5 text-xs">
        {[["Demo brand", 74, "28%", "bg-sun-400"], ["Competitor A", 64, "24%", "bg-[#8ea0bb]"], ["Competitor B", 50, "19%", "bg-[#65748b]"], ["Competitor C", 32, "12%", "bg-[#445167]"], ["Other tracked", 45, "17%", "bg-[#344054]"]].map(([name, width, value, color]) => <div className="contents" key={String(name)}><span className="text-white/60">{name}</span><div className="h-7 rounded-md bg-white/[0.05]"><div className={`h-full rounded-md ${color}`} style={{ width: `${width}%` }} /></div><span className="font-semibold text-white">{value}</span></div>)}
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4"><div className="flex items-center justify-between"><span className="text-xs text-white/45">ChatGPT</span><span className="text-sm font-semibold">31% SoV</span></div><div className="mt-3 h-1.5 rounded-full bg-white/10"><div className="h-full w-[62%] rounded-full bg-sun-400" /></div></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4"><div className="flex items-center justify-between"><span className="text-xs text-white/45">Gemini</span><span className="text-sm font-semibold">25% SoV</span></div><div className="mt-3 h-1.5 rounded-full bg-white/10"><div className="h-full w-1/2 rounded-full bg-sun-400" /></div></div>
      </div>
    </div>
  );
}

export function EvidenceSection() {
  return (
    <section className="border-y border-ink-100 bg-sun-50 py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-6 lg:px-10">
        <SectionIntro eyebrow="Evidence, not a black box" title="Follow every metric back to the answer." body="A percentage is only useful when you can see what produced it. Project Sun preserves the route from a metric to its contributing prompts, responses, detected brands, and sources." centered />
        <div className="mt-14 overflow-hidden rounded-2xl border border-sun-200 bg-white shadow-[0_24px_70px_-50px_rgba(120,70,10,0.45)]">
          <div className="grid gap-px bg-ink-100 lg:grid-cols-[0.72fr_1fr_1.35fr_0.9fr_0.82fr]">
            <TraceNode kicker="Figure" title="Named unprompted 42%" body="8 of 19 Discovery answers" accent />
            <TraceNode kicker="Question" title="Best providers for…" body="Discovery · names no brand" />
            <TraceNode kicker="Answer" title="Demo brand appears…" body="ChatGPT on the web · sources kept" />
            <TraceNode kicker="Linked" title="3 tracked brands" body="Demo brand ranked #2" />
            <TraceNode kicker="Sources" title="2 pages shown" body="1 of them yours" />
          </div>
          <div className="flex flex-col justify-between gap-4 border-t border-ink-100 px-6 py-5 text-sm text-ink-500 sm:flex-row sm:items-center"><span>Illustrative evidence path. The working product opens the exact contributing observation for each measured KPI.</span><span className="shrink-0 font-semibold text-ink-900">Nothing disappears into a score.</span></div>
        </div>
      </div>
    </section>
  );
}

function TraceNode({ kicker, title, body, accent = false }: { kicker: string; title: string; body: string; accent?: boolean }) {
  return <div className={`relative min-h-40 p-5 ${accent ? "bg-[#111827] text-white" : "bg-white text-ink-900"}`}><div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${accent ? "text-sun-300" : "text-ink-400"}`}>{kicker}</div><div className="mt-6 text-base font-semibold leading-5">{title}</div><div className={`mt-2 text-xs leading-5 ${accent ? "text-white/50" : "text-ink-400"}`}>{body}</div><span className={`absolute bottom-4 right-4 text-lg ${accent ? "text-sun-300" : "text-ink-200"}`} aria-hidden="true">→</span></div>;
}

const INDUSTRIES = ["SaaS", "Ecommerce", "Restaurants", "Dealerships", "Healthcare", "Local services", "Multi-location"];

export function IndustrySection() {
  return (
    <section className="border-b border-ink-100 bg-white py-20">
      <div className="mx-auto max-w-[1180px] px-6 text-center lg:px-10">
        <Eyebrow>Built around the business, not a template</Eyebrow>
        <h2 className="mx-auto mt-4 max-w-3xl text-balance text-3xl font-semibold tracking-[-0.035em] text-ink-950 sm:text-4xl">The prompt framework adapts to how different businesses are discovered and evaluated.</h2>
        <div className="mt-10 flex flex-wrap justify-center gap-2.5">{INDUSTRIES.map(industry => <span key={industry} className="rounded-full border border-ink-200 bg-ink-50 px-4 py-2 text-sm font-medium text-ink-600">{industry}</span>)}</div>
      </div>
    </section>
  );
}

const METRICS = [
  ["Named unprompted", "42%", "8 of 19 Discovery answers", "How often the brand is named when a buyer asks a question that never mentions it."],
  ["Share of voice", "28%", "8 of 29 tracked-brand mentions", "Of every time you or a tracked competitor was named in those answers, how many times it was you."],
  ["Rank", "#2.4", "over 5 ordered answers", "Where the brand sits when an answer puts options in a definite order; never guessed from prose."],
  ["Your site cited", "3 of 8", "answers that showed sources", "Whether the sources the page showed included one of your own pages."],
  ["Coverage", "87%", "26 of 30 collected", "How much of the planned set produced a usable answer. A missing answer is never counted as absence."],
] as const;

export function MetricsSection() {
  return (
    <section className="bg-[#f8fafc] py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-6 lg:px-10">
        <SectionIntro eyebrow="The measurement layer" title="A small metric set with clear meaning." body="Each measurement states its denominator and scope. Failures reduce coverage; they are not quietly counted as brand absence." />
        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-6">
          {METRICS.map(([name, value, note, body], index) => <article key={name} className={`group overflow-hidden rounded-2xl border p-6 transition duration-300 hover:-translate-y-1 hover:shadow-lg ${index < 2 ? "border-ink-800 bg-[#111827] text-white lg:col-span-3" : index === 4 ? "border-sun-200 bg-sun-50 lg:col-span-2" : "border-ink-200 bg-white lg:col-span-2"}`}><div className={`text-xs font-semibold uppercase tracking-[0.14em] ${index < 2 ? "text-white/45" : "text-ink-400"}`}>{name}</div><div className="mt-5 flex items-end justify-between gap-4"><div className="text-4xl font-semibold tracking-[-0.04em]">{value}</div><div className={`text-right text-xs ${index < 2 ? "text-white/40" : "text-ink-400"}`}>{note}</div></div><div className={`my-5 h-px ${index < 2 ? "bg-white/10" : "bg-ink-100"}`} /><p className={`text-sm leading-6 ${index < 2 ? "text-white/60" : "text-ink-500"}`}>{body}</p></article>)}
        </div>
        <p className="mt-5 text-xs text-ink-400">All values above are illustrative examples, not measured customer results.</p>
      </div>
    </section>
  );
}

export function ProviderSection() {
  return (
    <section className="border-y border-ink-100 bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-[1180px] px-6 lg:px-10">
        <SectionIntro eyebrow="AI-answer surfaces" title="Measure the route you actually observed." body="AI providers can differ by model, search behavior, formatting, and citations. Project Sun labels the observation surface instead of implying every route is equivalent." centered />
        <div className="mt-14 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-ink-200 bg-[#111827] p-6 text-white sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[0.15em] text-sun-300">Current Phase 2 measurement</div><h3 className="mt-2 text-2xl font-semibold">ChatGPT and Gemini</h3></div><span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-200">Available in this build</span></div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <ProviderCard initials="C" name="ChatGPT" detail="chatgpt.com, signed out, web search on" note="Every answer keeps its question, time and sources, and records which provider collected it." />
              <ProviderCard initials="G" name="Gemini" detail="gemini.google.com, signed out" note="Reported on its own and together with ChatGPT, so you can see where the picture changes." />
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-white/55"><span className="font-semibold text-white/80">The public surface, not an API:</span> answers are what the assistant&apos;s website showed a signed-out visitor in a fresh conversation, collected through a provider that opens the site for us. No provider is licensed by OpenAI or Google, and every answer says which one collected it.</div>
          </div>
          <div className="rounded-2xl border border-ink-200 bg-ink-50 p-6 sm:p-8">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-400">Designed to extend</div><h3 className="mt-2 text-2xl font-semibold text-ink-900">A provider-aware architecture</h3><p className="mt-4 text-sm leading-6 text-ink-500">The measurement model separates provider experience, route, method, adapter version, and observation time. Additional providers can be added later without presenting them as live today.</p>
            <div className="mt-8 space-y-3">{["Provider experience", "Collection route", "Retrieval state", "Observation timestamp"].map((item, index) => <div key={item} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 text-sm text-ink-600"><span className="grid h-6 w-6 place-items-center rounded-md bg-ink-100 text-[10px] font-semibold text-ink-400">0{index + 1}</span>{item}</div>)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProviderCard({ initials, name, detail, note }: { initials: string; name: string; detail: string; note: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-white text-sm font-bold text-ink-900">{initials}</span><div><div className="text-sm font-semibold">{name}</div><div className="mt-0.5 text-xs text-white/40">{detail}</div></div></div><p className="mt-4 text-xs leading-5 text-white/50">{note}</p></div>;
}

const METHOD_POINTS = [
  ["Brand-blind neutral prompts", "Target names, aliases, domains, and marketing language are withheld from neutral discovery generation, then leakage is checked again."],
  ["Review before measurement", "The selected prompt cohort remains visible and editable before it is approved for observation."],
  ["Failures change coverage", "Failed, incomplete, or unavailable observations do not enter visibility denominators as false absences."],
  ["Reproducible evidence", "Provider, route, prompt version, sample, time, response, detections, and supporting observation IDs stay connected."],
] as const;

export function MethodologySection() {
  return (
    <section id="methodology" className="scroll-mt-20 bg-[#0c121d] py-24 text-white sm:py-32">
      <div className="mx-auto max-w-[1180px] px-6 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.78fr_1.22fr] lg:gap-20">
          <div><Eyebrow inverted>Methodology</Eyebrow><h2 className="mt-4 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-5xl">Rigor you can explain to a marketing lead.</h2><p className="mt-5 text-lg leading-8 text-white/55">The product is designed around one principle: a metric should never look more certain than the observations behind it.</p><div className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/55"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Evidence-first measurement</div></div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2">{METHOD_POINTS.map(([title, body], index) => <div key={title} className="bg-[#111927] p-6 sm:p-7"><div className="text-xs font-semibold text-sun-300">0{index + 1}</div><h3 className="mt-5 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-white/50">{body}</p></div>)}</div>
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  ["What does AI visibility mean?", "AI visibility describes whether and how a brand appears when an AI system answers relevant buyer questions. Project Sun focuses on observable outcomes: whether the brand is named unprompted, its share of every business named and of a confirmed competitive set, its rank when an answer gives one, head-to-head verdicts, how it is described by name, which sources were cited, and how much of the planned set was collected."],
  ["How are the prompts selected?", "Project Sun starts from the business profile and market context you confirm. It generates a larger candidate pool, validates and deduplicates it, checks neutral prompts for brand leakage, and selects a balanced 30-prompt cohort across relevant topics, intents, personas, geography, and prompt types."],
  ["What is the difference between named unprompted and share of voice?", "Named unprompted measures how often your brand is named in Discovery answers, questions that never mention it. Share of every business named compares your mentions with every business those answers named, and share of voice with the confirmed competitive set only. They answer different questions and all show their fraction."],
  ["Why are some prompts brand-neutral?", "A prompt that names your brand makes a mention more likely. Neutral prompts test whether the brand appears when a buyer asks about the category or problem without being prompted to consider it. Brand-aware and comparison prompts are still useful, but they are reported separately."],
  ["Which AI platforms are measured?", "ChatGPT and Gemini. Each approved question is asked on the assistant's own website, in a signed-out browser session; the answer comes back with the sources the page showed. Every answer records when and from where it was collected, and results are reported for each assistant and for both together."],
  ["How does Project Sun use my website?", "It safely crawls public pages to build a structured understanding of the business, including offerings, audience, market, and geography. You review and can edit that understanding before it is used to define topics, competitors, or prompts."],
  ["Are measurements deterministic?", "AI answers can vary, so the observations are not assumed to be deterministic. Project Sun retains the provider, route, prompt, sample, time, and response context, and keeps failed or incomplete observations out of visibility denominators. The metric calculations themselves are reproducible from the captured evidence."],
] as const;

export function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-20 bg-white py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1100px] gap-12 px-6 lg:grid-cols-[0.65fr_1.35fr] lg:px-10">
        <div><Eyebrow>FAQ</Eyebrow><h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-ink-950">Questions worth asking before you trust a score.</h2><p className="mt-5 text-base leading-7 text-ink-500">Project Sun treats methodology as part of the product, not a footnote.</p></div>
        <div className="divide-y divide-ink-100 border-y border-ink-100">
          {FAQS.map(([question, answer], index) => <details key={question} className="group py-1"><summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-6 rounded py-5 text-left text-base font-semibold text-ink-900"><span className="flex gap-4"><span className="text-sm font-medium text-ink-300">{String(index + 1).padStart(2, "0")}</span>{question}</span><span className="text-xl font-light text-ink-400 transition-transform group-open:rotate-45">+</span></summary><p className="max-w-3xl pb-6 pl-10 pr-8 text-sm leading-7 text-ink-500">{answer}</p></details>)}
        </div>
      </div>
    </section>
  );
}

export function FinalCtaSection() {
  return (
    <section className="bg-sun-400 px-6 py-20 sm:py-24">
      <div className="mx-auto grid max-w-[1180px] items-center gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
        <div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-sun-900">Start with what you already have</div><h2 className="mt-4 text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-ink-950 sm:text-5xl">Enter your website. See how your brand is represented.</h2><p className="mt-5 text-base leading-7 text-sun-900">Project Sun builds the business context first, lets you review it, then moves into buyer prompts and measurement.</p></div>
        <div><WebsiteStartForm id="final-website" /><p className="mt-3 text-xs text-sun-900">Public website required · No card needed for this local Phase 2 trial</p></div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="bg-[#0c121d] py-12 text-white">
      <div className="mx-auto max-w-[1180px] px-6 lg:px-10">
        <div className="flex flex-col justify-between gap-10 border-b border-white/10 pb-10 sm:flex-row">
          <div className="max-w-sm"><Link href="/" className="focus-ring flex w-fit items-center gap-2.5 rounded"><span className="sun-mark" aria-hidden="true"><span /></span><span className="font-semibold">Project Sun</span></Link><p className="mt-4 text-sm leading-6 text-white/45">Evidence-backed measurement for understanding how brands appear when buyers ask AI.</p></div>
          <nav aria-label="Footer navigation" className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm text-white/55 sm:grid-cols-3">{([['Product', '#product'], ['How it works', '#how-it-works'], ['AI Visibility', '#visibility'], ['Methodology', '#methodology'], ['FAQ', '#faq'], ['Start analysis', '/trial/new']] as const).map(([label, href]) => <Link key={href} href={href} className="focus-ring rounded transition hover:text-white">{label}</Link>)}</nav>
        </div>
        <div className="flex flex-col justify-between gap-3 pt-6 text-xs text-white/30 sm:flex-row"><span>Project Sun · Phase 2 Measure build</span><span>Product proof over invented proof.</span></div>
      </div>
    </footer>
  );
}
