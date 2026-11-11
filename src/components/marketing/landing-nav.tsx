"use client";

import Link from "next/link";
import { useState } from "react";

const LINKS = [["Product", "#product"], ["How it works", "#how-it-works"], ["AI Visibility", "#visibility"], ["Methodology", "#methodology"], ["FAQ", "#faq"]] as const;

export function LandingNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-ink-100/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6 lg:px-10">
        <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-md" aria-label="Project Sun home"><span className="sun-mark" aria-hidden="true"><span /></span><span className="text-[15px] font-semibold tracking-[-0.02em] text-ink-950">Project Sun</span></Link>
        <nav className="hidden items-center gap-7 lg:flex" aria-label="Main navigation">
          {LINKS.map(([label, href]) => <Link key={href} href={href} className="focus-ring rounded text-sm font-medium text-ink-500 transition-colors hover:text-ink-950">{label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/trial/new" className="focus-ring hidden rounded-lg bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800 sm:inline-flex">Start free analysis <span aria-hidden="true" className="ml-1">→</span></Link>
          <div className="relative lg:hidden">
            <button type="button" onClick={() => setOpen((value) => !value)} className="focus-ring flex h-10 w-10 items-center justify-center rounded-lg border border-ink-200 text-ink-800 sm:hidden" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-navigation"><span className="space-y-1" aria-hidden="true"><i className="block h-px w-4 bg-current" /><i className="block h-px w-4 bg-current" /><i className="block h-px w-4 bg-current" /></span></button>
            {open && <div id="mobile-navigation" className="absolute right-0 top-12 w-64 rounded-xl border border-ink-200 bg-white p-2 shadow-xl sm:hidden">
              {LINKS.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50">{label}</Link>)}
              <Link href="/trial/new" onClick={() => setOpen(false)} className="mt-1 block rounded-lg bg-ink-950 px-3 py-2.5 text-center text-sm font-semibold text-white">Start free analysis</Link>
            </div>}
          </div>
        </div>
      </div>
    </header>
  );
}
