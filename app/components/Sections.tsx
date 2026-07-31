"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  Stage,
  FunnelStage,
  DealValues,
  QuotaProgress,
  RepStat,
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

// ---- Quota tracker -------------------------------------------------------
// One card, full width. By default it shows ALL-TIME progress against the
// all-time target (BDR $600k / team $3.6M); pick a month in the filter and it
// narrows to "This Month" against the monthly target. The window label follows
// whichever view is in play.
export function QuotaCard({
  quota,
  perBdr,
}: {
  quota: QuotaProgress;
  perBdr: boolean;
}) {
  return (
    <section className="mb-10">
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <SectionLabel>
            {perBdr ? "BDR Progress" : "Team Progress"} ·{" "}
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

// ---- Per-rep cards: clickable to filter, with a BDR / AE tab switch ------
export function RepCards({
  team,
  setTeam,
  stats,
  selected,
  onSelect,
  showQuota = true,
}: {
  team: "bdr" | "ae";
  setTeam: (t: "bdr" | "ae") => void;
  stats: RepStat[];
  selected: string; // "all" or a rep name
  onSelect: (name: string) => void;
  showQuota?: boolean; // AEs don't carry a BDR quota, so hide the bar for them
}) {
  // Netflix-style ENDLESS rail. We render the cards three times in a row and
  // keep the scroll position parked in the MIDDLE copy. When the rail comes to
  // rest we snap the position back into that middle copy using a modulo of one
  // copy-width. Every copy is identical, so the snap is invisible — and because
  // it only runs once the rail is IDLE (never mid-animation), it can't fight the
  // smooth arrow glides. The result: the row loops forever and the arrows keep
  // working no matter how many times you click.
  const railRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);
  const loop = stats.length > 0 ? [...stats, ...stats, ...stats] : stats;

  const wrapToMiddle = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const setW = el.scrollWidth / 3;
    if (setW === 0) return;
    const off = (((el.scrollLeft - setW) % setW) + setW) % setW; // 0 .. setW
    const normalized = setW + off;
    if (Math.abs(normalized - el.scrollLeft) > 1) el.scrollLeft = normalized;
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    // Start parked in the middle copy so there's content in BOTH directions.
    el.scrollLeft = el.scrollWidth / 3;
    // Re-center only after scrolling has settled (debounced), so it never
    // interrupts an in-flight smooth scroll from the arrows.
    const onScroll = () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(wrapToMiddle, 140);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", wrapToMiddle);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", wrapToMiddle);
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
    // Re-park when the card set changes (BDR ⇄ AE, roster updates).
  }, [wrapToMiddle, stats.length, team]);

  // Arrow click: glide by ~one screen-width. We animate the scroll ourselves with
  // requestAnimationFrame (an eased tween) rather than the browser's native
  // "smooth" option, which some engines silently ignore — this way the glide is
  // reliable everywhere. The idle re-center above loops it once the glide settles.
  function nudge(dir: 1 | -1) {
    const el = railRef.current;
    if (!el) return;
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    const from = el.scrollLeft;
    const to = from + dir * el.clientWidth * 0.85;
    const duration = 350;
    const start = performance.now();
    const ease = (p: number) =>
      p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      el.scrollLeft = from + (to - from) * ease(p);
      if (p < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
        wrapToMiddle();
      }
    };
    animRef.current = requestAnimationFrame(step);
  }

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

      <div className="relative">
        <RailArrow dir="left" show onClick={() => nudge(-1)} />
        <RailArrow dir="right" show onClick={() => nudge(1)} />

        <div
          ref={railRef}
          className="flex gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {loop.map((r, i) => (
            <Card
              key={`${r.name}-${i}`}
              onClick={() => onSelect(r.name)}
              active={selected === r.name}
              className="w-[280px] shrink-0"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.name}</span>
                {showQuota && (
                  <span className="text-sm text-neutral-400">{r.quotaPct}%</span>
                )}
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
              {showQuota && (
                <div className="mt-2">
                  <ProgressBar pct={r.quotaPct} />
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// A single frosted-glass "liquid glass" scroll arrow that floats over one edge
// of the rail. Fades/scales in only when there's more to scroll that way.
function RailArrow({
  dir,
  show,
  onClick,
}: {
  dir: "left" | "right";
  show: boolean;
  onClick: () => void;
}) {
  const left = dir === "left";
  return (
    <button
      type="button"
      aria-label={left ? "Scroll left" : "Scroll right"}
      onClick={onClick}
      className={`absolute top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/60 bg-white/70 text-neutral-700 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_10px_28px_-10px_rgba(0,0,0,0.35)] backdrop-blur-xl backdrop-saturate-150 transition-all duration-200 hover:bg-white/90 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.8),0_14px_32px_-10px_rgba(0,0,0,0.4)] active:scale-90 dark:border-white/15 dark:bg-neutral-800/70 dark:text-neutral-100 dark:hover:bg-neutral-800/90 ${
        left ? "left-1" : "right-1"
      } ${show ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        {left ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
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
