import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BriefcaseBusiness,
  CarFront,
  ChartNoAxesCombined,
  Gauge,
} from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
  onCustomerPortal?: () => void;
}

const features = [
  {
    icon: CarFront,
    title: 'Every vehicle, in view',
    detail: 'See what is in the shop, what needs attention, and what is ready to go.',
  },
  {
    icon: BriefcaseBusiness,
    title: 'Work orders that flow',
    detail: 'Keep job cards, technicians, and repair stages together from check-in to pickup.',
  },
  {
    icon: ChartNoAxesCombined,
    title: 'A clearer picture',
    detail: 'Make day-to-day decisions with a live view of workload and shop performance.',
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted, onSignIn, onCustomerPortal }) => (
  <div className="min-h-screen overflow-hidden bg-[#f4f7fb] text-[#111827]">
    <main>
    <div className="relative isolate overflow-hidden bg-[#07182b] text-white">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: "url('/assets/nextgen-workshop-hero.png')" }}
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-[#061426]/95 via-[#061426]/75 to-[#061426]/40" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#061426]/20" />
    <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
      <a href="#" className="flex items-center gap-2.5" aria-label="NEXTGEN home">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0b1c34] text-[#39a8ff] shadow-lg shadow-blue-950/15">
          <Gauge className="h-5 w-5" />
        </span>
        <span className="text-xl font-extrabold tracking-[0.12em]">NEXTGEN</span>
      </a>
      <nav className="flex items-center gap-3 sm:gap-8" aria-label="Main navigation">
        <a
          href="#features"
          className="hidden text-sm font-semibold text-white/75 transition hover:text-white sm:inline"
        >
          Features
        </a>
        <button
          type="button"
          onClick={onSignIn}
          className="rounded-full px-3 py-2 text-sm font-semibold text-white/85 transition hover:text-white sm:px-4"
        >
          Sign in Admin
        </button>
        <button
          type="button"
          onClick={onCustomerPortal ?? onGetStarted}
          className="rounded-full bg-[#1479e8] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#258bf5] sm:px-5"
        >
          Customer Portal
        </button>
      </nav>
    </header>
      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-80px)] max-w-7xl items-center px-5 pb-20 pt-10 sm:px-8 sm:pt-14 lg:px-12 lg:pb-28 lg:pt-16">
        <div className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#d5e9ff] backdrop-blur-sm">
            <span className="h-2 w-2 rounded-full bg-[#2d9cff]" />
          </div>
          <h1 className="text-5xl font-extrabold leading-[1.06] tracking-[-0.055em] sm:text-6xl lg:text-[4.35rem]">
            <span className="block">NEXTGEN vehicle service & repair</span>
            <span className="mt-2 block text-[#54b2ff]"></span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-white/80 sm:text-lg sm:leading-8">
            <span className="mt-2 block"></span>
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onGetStarted}
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#1479e8] px-6 py-3.5 text-sm font-bold text-white shadow-[0_12px_30px_rgba(4,17,37,0.35)] transition hover:-translate-y-0.5 hover:bg-[#258bf5]"
            >
              Explore NEXTGEN
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
            <a
              href="#features"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/20"
            >
              See what’s inside
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-semibold text-white/75">
            <span className="inline-flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-[#54b2ff]" />
            </span>
            <span className="inline-flex items-center gap-2">

            </span>
          </div>
        </div>

      </section>
    </div>

      <section id="features" className="border-t border-[#e1e8f1] bg-white/70">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
          <div className="max-w-xl">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#1b72c7]">Your day, made simpler</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] text-[#101c30] sm:text-4xl">
              Built around the work you do.
            </h2>
          </div>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, title, detail }, index) => (
              <article key={title} className="rounded-2xl border border-[#e5ebf3] bg-[#f9fbfe] p-6 sm:p-7">
                <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${index === 1 ? 'bg-[#e2f0ff] text-[#1479e8]' : 'bg-[#e6f0fc] text-[#285e99]'}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-base font-extrabold text-[#27364b]">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#78837c]">{detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
    <footer className="border-t border-[#e1e8f1] bg-[#f4f7fb]">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-6 text-xs font-medium text-[#849087] sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <span className="font-extrabold tracking-[0.14em] text-[#1b2b42]">NEXTGEN vehicle service & repair</span>
        <span></span>
      </div>
    </footer>
  </div>
);
