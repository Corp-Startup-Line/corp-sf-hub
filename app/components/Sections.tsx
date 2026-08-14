"use client";

import type {
  Stage,
  FunnelStage,
  DealValues,
  QuotaProgress,
  Kpis,
  Insight,
  InsightTone,
  Prospect,
} from "../lib/data";
import {
  effectiveStage,
  daysSinceContact,
  dealValue,
  hubspotUrl,
} from "../lib/data";
import {
  Card,
  SectionLabel,
  ProgressBar,
  StageBadge,
  money,
  moneyFull,
  type TintName,
} from "../lib/ui";

// ---- Headline KPI strip: at-a-glance numbers across the top ----------
export function KpiStrip({ kpis }: { kpis: Kpis }) {
  const items: { label: string; value: string; accent?: string; tint?: TintName }[] = [
    { label: "Closed Won", value: money(kpis.won), accent: "text-emerald-600 dark:text-emerald-400", tint: "emerald" },
    { label: "Avg Deal Size", value: money(kpis.avgDeal) },
    { label: "Deals", value: String(kpis.deals) },
  ];
  return (
    <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

// ---- Quota tracker -------------------------------------------------------
// One card, full width. By default it shows ALL-TIME progress against the
// all-time target (BDR $600k / team $3.6M); pick a month in the filter and it
// narrows to "This Month" against the monthly target. The window label follows
// whichever view is in play.
export function QuotaCard({
  quota,
  perRep,
  teamLabel = "BDR",
}: {
  quota: QuotaProgress;
  perRep: boolean;
  teamLabel?: string;
}) {
  return (
    <section className="mb-10">
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <SectionLabel>
            {perRep ? `${teamLabel} Progress` : "Team Progress"} ·{" "}
            {quota.allTime ? "All Time" : "This Month"}
          </SectionLabel>
          <span className="text-2xl font-medium">{quota.pct}%</span>
        </div>
        <ProgressBar pct={quota.pct} />
        <div className="mt-2 flex justify-between text-sm text-neutral-500 dark:text-neutral-400">
          <span>Won {money(quota.won)}</span>
          <span>Target {money(quota.target)}</span>
        </div>
      </Card>
    </section>
  );
}

// ---- At-risk deals: the per-BDR "chase these now" list -------------------
// Open deals where the customer hasn't made positive contact in 3+ days (or
// ever). This is the point of the single-BDR view: surface deals going stale
// or at risk of being poached before they slip away. Worst-first.
const AT_RISK_LIMIT = 12; // keep it a focused chase-list, not a wall of cards

export function AtRiskDeals({ deals }: { deals: Prospect[] }) {
  const shown = deals.slice(0, AT_RISK_LIMIT);
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <SectionLabel>At-Risk Deals · No positive contact in 3+ days</SectionLabel>
        {deals.length > 0 && (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            {deals.length} to chase
            {deals.length > AT_RISK_LIMIT ? ` · showing top ${AT_RISK_LIMIT}` : ""}
          </span>
        )}
      </div>
      {deals.length === 0 ? (
        <Card tint="emerald">
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              ✓
            </span>
            <p className="text-sm text-neutral-700 dark:text-neutral-200">
              All caught up — every open deal has had positive contact in the last 3 days.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((d) => {
            const days = daysSinceContact(d);
            const risk = days === null || days >= 4;
            return (
              <Card key={d.id} tint={risk ? "rose" : "amber"}>
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={hubspotUrl(d)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline-offset-2 transition hover:text-corgi-ginger hover:underline"
                  >
                    {d.company}
                  </a>
                  <StageBadge stage={effectiveStage(d)} />
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <span
                    className={`text-sm font-medium ${
                      risk
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {days === null
                      ? "No positive contact yet"
                      : `${days} days quiet`}
                  </span>
                  {dealValue(d) > 0 && (
                    <span className="text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
                      {moneyFull(dealValue(d))}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}



