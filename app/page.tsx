import Link from "next/link";
import TeamArrRing from "./components/TeamArrRing";

// The "front door": a simple landing page with two cards. Each card opens a
// full dashboard. Corgi SF Pipeline → the deals dashboard (React, at /pipeline).
// Corgi SF Metrics → the revenue/activity dashboard (served at /sf/index.html).
function DashboardCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <a
      href={href}
      className="group flex flex-col justify-between rounded-3xl border border-white/50 bg-gradient-to-b from-white/70 to-white/35 p-8 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-14px_rgba(0,0,0,0.22)] backdrop-blur-2xl backdrop-saturate-150 transition-all hover:-translate-y-1 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_18px_40px_-14px_rgba(0,0,0,0.28)] dark:border-white/[0.12] dark:from-white/[0.10] dark:to-white/[0.03] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_12px_34px_-14px_rgba(0,0,0,0.55)]"
    >
      <div>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          {description}
        </p>
      </div>
      <span className="mt-8 inline-flex items-center gap-1 text-sm font-medium text-corgi-ginger transition-transform group-hover:translate-x-1">
        Open →
      </span>
    </a>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Corgi Hub SF
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Choose a dashboard · live from HubSpot
        </p>
      </div>
      <figure className="mx-auto mb-12 max-w-2xl text-center">
        <blockquote className="text-balance text-xl font-medium leading-snug tracking-tight text-neutral-800 sm:text-2xl dark:text-neutral-100">
          <span className="text-corgi-ginger">&ldquo;</span>
          The money is already printed. You just gotta go get it.
          <span className="text-corgi-ginger">&rdquo;</span>
        </blockquote>
        <div className="mx-auto mt-6 h-px w-16 bg-gradient-to-r from-transparent via-corgi-ginger/60 to-transparent" />
      </figure>
      <TeamArrRing />
      <div className="grid gap-6 sm:grid-cols-2">
        <DashboardCard
          href="/pipeline"
          title="Corp SF Pipeline"
          description="Your deals in motion — win rate, closed won, conversion funnel, and at-risk accounts to chase."
        />
        <DashboardCard
          href="/sf/index.html"
          title="Corp SF Metrics"
          description="Rep activity and revenue — dials, demos booked, show rate, sourced ARR, and BDR & AE progress."
        />
      </div>
    </main>
  );
}
