import { LandingNav } from "@/components/marketing/landing-nav";
import { WebsiteStartForm } from "@/components/marketing/website-start-form";
import {
  EvidenceSection,
  FaqSection,
  FinalCtaSection,
  IndustrySection,
  LandingFooter,
  MeasurementSection,
  MethodologySection,
  MetricsSection,
  PromptIntelligenceSection,
  ProviderSection,
  SearchShiftSection,
  WorkflowSection,
} from "@/components/marketing/landing-sections";

export default function MarketingPage() {
  return (
    <main className="marketing-page min-h-screen overflow-hidden bg-white text-ink-950">
      <LandingNav />
      <section className="relative border-b border-ink-100 pt-16" aria-labelledby="hero-heading">
        <div className="sun-grid absolute inset-0 -z-10" />
        <div className="mx-auto grid min-h-[760px] max-w-[1280px] items-center gap-14 px-6 py-20 lg:grid-cols-[0.88fr_1.12fr] lg:px-10 lg:py-24">
          <div className="max-w-[620px]">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-sun-200 bg-sun-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-sun-800">
              <span className="h-1.5 w-1.5 rounded-full bg-sun-500" />
              AI visibility, measured with evidence
            </div>
            <h1 id="hero-heading" className="text-balance text-[clamp(3.25rem,6vw,5.8rem)] font-semibold leading-[0.96] tracking-[-0.065em] text-ink-950">
              Know where your brand stands in AI answers.
            </h1>
            <p className="mt-7 max-w-[590px] text-lg leading-8 text-ink-500 sm:text-xl">
              Project Sun discovers the questions buyers ask, observes how ChatGPT and Gemini answer, and measures whether your brand appears—with the evidence behind every number.
            </p>
            <div className="mt-9 max-w-[650px]">
              <WebsiteStartForm />
            </div>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-500">
              <span className="flex items-center gap-2"><span className="text-sun-600">01</span> Start with your website</span>
              <span className="flex items-center gap-2"><span className="text-sun-600">02</span> Review what Sun understands</span>
              <span className="flex items-center gap-2"><span className="text-sun-600">03</span> Every figure opens its answers</span>
            </div>
          </div>
          <HeroProductPreview />
        </div>
      </section>
      <SearchShiftSection />
      <WorkflowSection />
      <PromptIntelligenceSection />
      <MeasurementSection />
      <EvidenceSection />
      <IndustrySection />
      <MetricsSection />
      <ProviderSection />
      <MethodologySection />
      <FaqSection />
      <FinalCtaSection />
      <LandingFooter />
    </main>
  );
}

function HeroProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[720px] lg:max-w-none" aria-label="Illustrative Project Sun measurement preview">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-sun-100/60 blur-3xl" />
      <div className="overflow-hidden rounded-[1.4rem] border border-ink-200 bg-[#0d1420] shadow-[0_35px_90px_-35px_rgba(11,15,26,0.45)]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 text-white">
          <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sun-400" /><span className="text-sm font-semibold">Measurement overview</span></div>
          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/60">Illustrative data</span>
        </div>
        <div className="grid gap-px bg-white/10 sm:grid-cols-3">
          {[["Named unprompted", "42%", "8 of 19 Discovery answers"], ["Share of voice", "28%", "8 of 29 tracked-brand mentions"], ["Coverage", "87%", "26 of 30 answers collected"]].map(([label, value, note]) => (
            <div key={label} className="bg-[#0d1420] px-5 py-5"><div className="text-xs font-medium uppercase tracking-[0.12em] text-white/45">{label}</div><div className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</div><div className="mt-1 text-xs text-white/45">{note}</div></div>
          ))}
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Competitive presence</div><div className="flex gap-1.5 text-[10px] text-white/50"><span className="rounded bg-white/10 px-1.5 py-1">ChatGPT</span><span className="rounded bg-white/10 px-1.5 py-1">Gemini</span></div></div>
            <div className="mt-5 space-y-4">
              {[["Demo brand", "28%", "w-[74%]", "bg-sun-400"], ["Competitor A", "24%", "w-[64%]", "bg-white/65"], ["Competitor B", "19%", "w-[50%]", "bg-white/35"], ["Competitor C", "12%", "w-[32%]", "bg-white/20"]].map(([name, value, width, color]) => (
                <div key={name}><div className="mb-1.5 flex justify-between text-xs"><span className="text-white/70">{name}</span><span className="font-medium text-white">{value}</span></div><div className="h-1.5 rounded-full bg-white/10"><div className={`h-full rounded-full ${width} ${color}`} /></div></div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">Evidence trace</div><span className="text-[11px] text-emerald-300">Brand detected</span></div>
            <div className="mt-4 rounded-lg border border-white/10 bg-black/15 p-3"><div className="text-[10px] uppercase tracking-[0.12em] text-white/35">Buyer prompt · evaluation</div><p className="mt-1.5 text-sm leading-5 text-white/85">Which providers are best for multi-location teams that need consistent reporting?</p></div>
            <div className="mt-3 text-xs leading-5 text-white/55">“For teams comparing options, <mark className="rounded bg-sun-400/20 px-1 text-sun-200">Demo brand</mark> is one provider to consider alongside…”</div>
            <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-white/55"><span className="rounded-full border border-white/10 px-2 py-1">Named, ranked #2</span><span className="rounded-full border border-white/10 px-2 py-1">2 sources shown</span><span className="rounded-full border border-white/10 px-2 py-1">1 owned</span></div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-5 py-3 text-[11px] text-white/40"><span>Metric</span><span className="text-sun-300">→</span><span>Prompt</span><span className="text-sun-300">→</span><span>Answer</span><span className="text-sun-300">→</span><span>Detected brands</span><span className="text-sun-300">→</span><span>Sources</span></div>
      </div>
    </div>
  );
}
