"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function WebsiteStartForm({ dark = false, id = "hero-website" }: { dark?: boolean; id?: string }) {
  const router = useRouter();
  const [website, setWebsite] = useState("");
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = website.trim();
    router.push(value ? `/trial/new?url=${encodeURIComponent(value)}` : "/trial/new");
  }
  return (
    <form onSubmit={submit} className={`flex flex-col gap-2 rounded-xl border p-2 shadow-[0_18px_50px_-25px_rgba(15,23,42,0.35)] sm:flex-row ${dark ? "border-white/15 bg-white/10" : "border-ink-200 bg-white"}`}>
      <label htmlFor={id} className="sr-only">Your website</label>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3"><span className={dark ? "text-white/40" : "text-ink-300"}>https://</span><input id={id} value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="yourcompany.com" inputMode="url" autoComplete="url" className={`focus-ring min-h-12 min-w-0 flex-1 bg-transparent text-base outline-none ${dark ? "text-white placeholder:text-white/35" : "text-ink-950 placeholder:text-ink-300"}`} /></div>
      <button type="submit" className={`focus-ring inline-flex min-h-12 shrink-0 items-center justify-center rounded-lg px-5 text-sm font-semibold transition ${dark ? "bg-sun-400 text-ink-950 hover:bg-sun-300" : "bg-ink-950 text-white hover:bg-ink-800"}`}>Analyze my brand <span aria-hidden="true" className="ml-2">→</span></button>
    </form>
  );
}
