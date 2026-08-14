import type { ReactNode } from "react";
import TeamArrRing from "./components/TeamArrRing";

// Small stroke icon wrapper (Lucide-style paths) used by the playbook panels.
function Ico({ children, size = 17 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type Duty = { icon: ReactNode; title: string; body: string };

// A "daily playbook" card: a titled list of non-negotiable daily habits, each
// with a soft ginger icon tile, a bold headline, and a supporting line.
function PlaybookPanel({
  kicker,
  title,
  duties,
}: {
  kicker: string;
  title: string;
  duties: Duty[];
}) {
  return (
    <section className="rounded-3xl border border-white/50 bg-gradient-to-b from-white/70 to-white/35 p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-14px_rgba(0,0,0,0.22)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.12] dark:from-white/[0.10] dark:to-white/[0.03] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_12px_34px_-14px_rgba(0,0,0,0.55)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400 dark:text-neutral-500">
        {kicker}
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
      <ul className="mt-4 divide-y divide-black/[0.06] dark:divide-white/10">
        {duties.map((d) => (
          <li key={d.title} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-corgi-ginger/10 text-corgi-ginger">
              {d.icon}
            </span>
            <div>
              <h3 className="text-[14px] font-semibold tracking-tight">
                {d.title}
              </h3>
              <p className="mt-0.5 text-[13px] leading-snug text-neutral-600 dark:text-neutral-300">
                {d.body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const BDR_DUTIES: Duty[] = [
  {
    icon: (
      <Ico>
        <path d="M12 2v8" />
        <path d="m4.93 10.93 1.41 1.41" />
        <path d="M2 18h2" />
        <path d="M20 18h2" />
        <path d="m19.07 10.93-1.41 1.41" />
        <path d="M22 22H2" />
        <path d="m8 6 4-4 4 4" />
        <path d="M16 18a4 4 0 0 0-8 0" />
      </Ico>
    ),
    title: "Prospect first, 90 min, no exceptions",
    body: "Hottest deals first — call, then personalized sends. This block is where your number gets made. Nothing goes ahead of it.",
  },
  {
    icon: (
      <Ico>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M3 10h18" />
        <path d="m9 16 2 2 4-4" />
      </Ico>
    ),
    title: "Confirm every demo, twice",
    body: "24 hours out and 30 minutes out. Skip it and your show rate — and your number — drops.",
  },
  {
    icon: (
      <Ico>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </Ico>
    ),
    title: "Clear the activity floor",
    body: "Min 500 dials, min 20 emails. This is the floor to hit quota, not the ceiling.",
  },
  {
    icon: (
      <Ico>
        <path d="m17 2 4 4-4 4" />
        <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
        <path d="m7 22-4-4 4-4" />
        <path d="M21 13v1a4 4 0 0 1-4 4H3" />
      </Ico>
    ),
    title: "Touch every active deal every 48h",
    body: "A deal you let go quiet is a deal you lose. Keep every one moving.",
  },
  {
    icon: (
      <Ico>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5V19A9 3 0 0 0 21 19V5" />
        <path d="M3 12A9 3 0 0 0 21 12" />
      </Ico>
    ),
    title: "Log everything in real time",
    body: "Call logged, next step dated, stage accurate. If it's not in HubSpot, it didn't happen.",
  },
  {
    icon: (
      <Ico>
        <path d="m3 17 2 2 4-4" />
        <path d="m3 7 2 2 4-4" />
        <path d="M13 6h8" />
        <path d="M13 12h8" />
        <path d="M13 18h8" />
      </Ico>
    ),
    title: "Build tomorrow before you leave",
    body: "List built, sends queued, calendar checked. Walk in at 9 already dialing.",
  },
];

const AE_DUTIES: Duty[] = [
  {
    icon: (
      <Ico>
        <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m9 14 2 2 4-4" />
      </Ico>
    ),
    title: "Prep every call before you take it",
    body: "Research the account, set the agenda, know the one outcome you want.",
  },
  {
    icon: (
      <Ico>
        <circle cx="12" cy="12" r="10" />
        <path d="m12 8 4 4-4 4" />
        <path d="M8 12h8" />
      </Ico>
    ),
    title: "Move every deal one step forward",
    body: "No open deal ends the day without a scheduled, mutual next step.",
  },
  {
    icon: (
      <Ico>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </Ico>
    ),
    title: "Respond fast, follow up faster",
    body: "Same-day replies to live deals. Recap and send docs while it's warm.",
  },
  {
    icon: (
      <Ico>
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </Ico>
    ),
    title: "Keep the pipeline honest",
    body: "Real stages, real dates, real close amounts. Kill dead deals, don't park them.",
  },
  {
    icon: (
      <Ico>
        <path d="M7 20h10" />
        <path d="M10 20c5.5-2.5.8-6.4 3-10" />
        <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
        <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" />
      </Ico>
    ),
    title: "Self-source, don't just wait on BDRs",
    body: "Block time to prospect your own accounts and work past customers for referrals.",
  },
];

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
      className="group flex flex-col justify-between rounded-3xl border border-white/50 bg-gradient-to-b from-white/70 to-white/35 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-14px_rgba(0,0,0,0.22)] backdrop-blur-2xl backdrop-saturate-150 transition-all hover:-translate-y-1 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_18px_40px_-14px_rgba(0,0,0,0.28)] dark:border-white/[0.12] dark:from-white/[0.10] dark:to-white/[0.03] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_12px_34px_-14px_rgba(0,0,0,0.55)]"
    >
      <div>
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          {title}
        </h2>
        <p className="mt-1.5 text-[13px] leading-snug text-neutral-600 dark:text-neutral-300">
          {description}
        </p>
      </div>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-corgi-ginger transition-transform group-hover:translate-x-1">
        Open →
      </span>
    </a>
  );
}

// Wide card for the static Outbound Playbook reference (served from
// /public/outbound/index.html). Same shape as the Cold Call Playbook card so the
// field guides read as a set; opens in a new tab with a send/outbound icon.
function OutboundPlaybookCard() {
  return (
    <a
      href="/outbound/index.html"
      target="_blank"
      rel="noopener noreferrer"
      className="group mt-6 flex items-center gap-5 rounded-3xl border border-white/50 bg-gradient-to-b from-white/70 to-white/35 p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-14px_rgba(0,0,0,0.22)] backdrop-blur-2xl backdrop-saturate-150 transition-all hover:-translate-y-1 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_18px_40px_-14px_rgba(0,0,0,0.28)] dark:border-white/[0.12] dark:from-white/[0.10] dark:to-white/[0.03] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_12px_34px_-14px_rgba(0,0,0,0.55)]"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-corgi-ginger/10 text-corgi-ginger">
        <Ico size={26}>
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </Ico>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400 dark:text-neutral-500">
          Reference · BDR Field Guide
        </p>
        <h2 className="mt-0.5 text-xl font-semibold tracking-tight">
          Outbound Playbook
        </h2>
        <p className="mt-1 text-[13px] leading-snug text-neutral-600 dark:text-neutral-300">
          Call scripts, policy battle cards, and email templates with subject
          lines — the full outbound reference.
        </p>
      </div>
      <span className="ml-2 hidden shrink-0 items-center gap-1.5 rounded-full bg-corgi-ginger px-4 py-2 text-sm font-medium text-white transition-transform group-hover:translate-x-0.5 sm:inline-flex">
        Open
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 17 17 7" />
          <path d="M7 7h10v10" />
        </svg>
      </span>
    </a>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Corp SF Hub
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Choose a dashboard · live from HubSpot
        </p>
      </div>
      <figure className="mx-auto mb-8 max-w-2xl text-center">
        <blockquote className="text-balance text-lg font-medium leading-snug tracking-tight text-neutral-800 sm:text-xl dark:text-neutral-100">
          <span className="text-corgi-ginger">&ldquo;</span>
          The money is already printed. You just gotta go get it.
          <span className="text-corgi-ginger">&rdquo;</span>
        </blockquote>
        <div className="mx-auto mt-4 h-px w-16 bg-gradient-to-r from-transparent via-corgi-ginger/60 to-transparent" />
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
      <OutboundPlaybookCard />

      <div className="mt-8 mb-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          The Daily Playbook
        </h2>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Non-negotiables that make the number
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <PlaybookPanel
          kicker="Daily Responsibilities"
          title="BDR Non-negotiables"
          duties={BDR_DUTIES}
        />
        <PlaybookPanel
          kicker="Daily Responsibilities"
          title="What a solid AE does every day"
          duties={AE_DUTIES}
        />
      </div>
    </main>
  );
}
