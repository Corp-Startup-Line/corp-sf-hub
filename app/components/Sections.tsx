"use client";

import type {
  Stage,
  FunnelStage,
  DealValues,
  QuotaProgress,
  RepStat,
  Kpis,
  Insight,
  InsightTone,
} from "../lib/data";
import {
  Card,
  SectionLabel,
  ProgressBar,
  money,
  moneyFull,
  type TintName,
} from "../lib/ui";

// Win rate is a performance number, so its colour is worked out from the value:
// a healthy rate glows green, a shaky one amber, a poor one red — and the card
// glass is tinted to match.
function winRateTone(pct: number): { num: string; tint: TintName } {
  if (pct >= 50) return { num: "text-emerald-600 dark:text-emerald-400", tint: "emerald" };
  if (pct >= 30) return { num: "text-amber-600 dark:text-amber-400", tint: "amber" };
  return { num: "text-rose-600 dark:text-rose-400", tint: "rose" };
}

// ---- Headline KPI strip: five at-a-glance numbers across the top ----------
export function KpiStrip({ kpis }: { kpis: Kpis }) {
  const wr = winRateTone(kpis.winRate);
  const items: { label: string; value: string; accent?: string; tint?: TintName }[] = [
    { label: "Pipeline Value", value: money(kpis.pipeline), accent: "text-corgi-ginger", tint: "ginger" },
    { label: "Closed Won", value: money(kpis.won), accent: "text-emerald-600 dark:text-emerald-400", tint: "emerald" },
    { label: "Win Rate", value: `${kpis.winRate}%`, accent: wr.num, tint: wr.tint },
    { label: "Avg Deal Size", value: money(kpis.avgDeal) },
    { label: "Deals", value: String(kpis.deals) },
  ];
  return (
    <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((it) => (
        <Card key={it.label} tint={it.tint}>
          <div className="text-xs uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {it.label}
          </div>
          <div className={`mt-1 text-2xl font-medium tracking-tight ${it.accent ?? ""}`}>
            {it.value}
          </div>
        </Card>
      ))}
    </section>
  );
}

// Each funnel stage gets its own hue so the pipeline reads as a gradient of
// steps, not a wall of one colour. Colours match the stage badges elsewhere:
// ginger (all) → violet → sky → amber → emerald (won) → rose (ghosting).
const FUNNEL_TONE: Record<Stage | "all", { num: string; bar: string; tint: TintName }> = {
  all: { num: "text-corgi-ginger", bar: "bg-corgi-ginger", tint: "ginger" },
  "Meeting Booked": { num: "text-violet-600 dark:text-violet-400", bar: "bg-violet-500", tint: "violet" },
  Qualified: { num: "text-sky-600 dark:text-sky-400", bar: "bg-sky-500", tint: "sky" },
  Quoted: { num: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500", tint: "amber" },
  "Closed Won": { num: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", tint: "emerald" },
  Ghosting: { num: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500", tint: "rose" },
  "Closed Lost": { num: "text-slate-600 dark:text-slate-400", bar: "bg-slate-500", tint: "slate" },
};

function funnelTone(filter: Stage | "all"): { num: string; bar: string; tint: TintName } {
  return FUNNEL_TONE[filter];
}

// ---- Automated insights: plain-English callouts that follow the filters ---
const INSIGHT_STYLE: Record<InsightTone, { icon: string; badge: string }> = {
  success: {
    icon: "✓",
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    icon: "!",
    badge: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  },
  info: {
    icon: "i",
    badge: "bg-corgi-ginger/15 text-corgi-ginger",
  },
};

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <section className="mb-10">
      <SectionLabel>Insights</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {insights.map((n, i) => {
          const s = INSIGHT_STYLE[n.tone];
          return (
            <Card key={i} className="flex items-start gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${s.badge}`}
              >
                {s.icon}
              </span>
              <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">
                {n.text}
              </p>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

// ---- Conversion funnel: six clickable, colour-coded stat cards -----------
export function Funnel({
  funnel,
  activeStage,
  onSelect,
}: {
  funnel: FunnelStage[];
  activeStage: Stage | "all";
  onSelect: (filter: Stage | "all") => void;
}) {
  return (
    <section className="mb-10">
      <SectionLabel>Conversion Funnel</SectionLabel>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
        {funnel.map((s) => {
          const tone = funnelTone(s.filter);
          const active = activeStage !== "all" && s.filter === activeStage;
          return (
            <Card key={s.label} onClick={() => onSelect(s.filter)} active={active} tint={tone.tint}>
              <div className={`mb-3 h-1 w-8 rounded-full ${tone.bar}`} />
              <div className={`text-3xl font-medium tracking-tight ${tone.num}`}>
                {s.count}
              </div>
              <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                {s.label}
              </div>
              <div className="mt-2 text-xs text-neutral-400">{s.pct}% of total</div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

// ---- Deal value: three cards, two of them clickable ----------------------
export function DealValue({
  values,
  sortByWon,
  wonOnly,
  onToggleSort,
  onToggleWonOnly,
}: {
  values: DealValues;
  sortByWon: boolean;
  wonOnly: boolean;
  onToggleSort: () => void;
  onToggleWonOnly: () => void;
}) {
  return (
    <section className="mb-10">
      <SectionLabel>Deal Value</SectionLabel>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            Total Pipeline Value
          </div>
          <div className="mt-1 text-3xl font-medium">{money(values.pipeline)}</div>
        </Card>

        <Card onClick={onToggleSort} active={sortByWon} tint="emerald">
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            Closed Won Value
          </div>
          <div className="mt-1 text-3xl font-medium text-emerald-600 dark:text-emerald-400">
            {money(values.won)}
          </div>
          <div className="mt-2 text-xs text-neutral-400">
            {sortByWon ? "✓ Table sorted by size" : "Click to sort deals by size ↓"}
          </div>
        </Card>

        <Card onClick={onToggleWonOnly} active={wonOnly}>
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            Average Deal Size
          </div>
          <div className="mt-1 text-3xl font-medium">{money(values.avgDeal)}</div>
          <div className="mt-2 text-xs text-neutral-400">
            {wonOnly ? "✓ Showing won deals only" : "Click to show won deals only"}
          </div>
        </Card>
      </div>
    </section>
  );
}

// ---- Quota tracker + confirmed-revenue card ------------------------------
export function QuotaAndRevenue({
  quota,
  confirmed,
  perBdr,
}: {
  quota: QuotaProgress;
  confirmed: number;
  perBdr: boolean;
}) {
  return (
    <section className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="mb-2 flex items-baseline justify-between">
          <SectionLabel>{perBdr ? "BDR Progress" : "Team Progress"}</SectionLabel>
          <span className="text-2xl font-medium">{quota.pct}%</span>
        </div>
        <ProgressBar pct={quota.pct} />
        <div className="mt-2 flex justify-between text-sm text-neutral-500 dark:text-neutral-400">
          <span>Won {money(quota.won)}</span>
          <span>Target {money(quota.target)}</span>
        </div>
      </Card>

      <Card tint="emerald">
        <SectionLabel>Confirmed Revenue</SectionLabel>
        <div className="text-3xl font-medium text-emerald-600 dark:text-emerald-400">
          {money(confirmed)}
        </div>
        <div className="mt-2 text-xs text-neutral-400">via Django CRM (sample)</div>
      </Card>
    </section>
  );
}

// ---- Per-rep cards: clickable to filter, with a BDR / AE tab switch ------
export function RepCards({
  team,
  setTeam,
  stats,
  selected,
  onSelect,
}: {
  team: "bdr" | "ae";
  setTeam: (t: "bdr" | "ae") => void;
  stats: RepStat[];
  selected: string; // "all" or a rep name
  onSelect: (name: string) => void;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <SectionLabel>Individual Breakdown</SectionLabel>
        <div className="inline-flex rounded-full border border-black/10 bg-white/60 p-1 text-sm backdrop-blur-xl dark:border-white/15 dark:bg-white/10">
          {(["bdr", "ae"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTeam(t)}
              className={`rounded-full px-4 py-1.5 transition ${
                team === t
                  ? "bg-corgi-ginger text-white"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              {t === "bdr" ? "BDRs" : "AEs"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {stats.map((r) => (
          <Card key={r.name} onClick={() => onSelect(r.name)} active={selected === r.name}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.name}</span>
              <span className="text-sm text-neutral-400">{r.quotaPct}%</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="Deals" value={r.prospects} />
              <Stat label="Meetings" value={r.meetings} />
              <Stat label="Quoted" value={r.quoted} />
            </div>
            <div className="mt-3 flex items-baseline justify-between text-sm">
              <span className="text-neutral-500 dark:text-neutral-400">
                {r.wonCount} won
              </span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {moneyFull(r.wonValue)}
              </span>
            </div>
            <div className="mt-2">
              <ProgressBar pct={r.quotaPct} />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-medium">{value}</div>
      <div className="text-xs text-neutral-400">{label}</div>
    </div>
  );
}
