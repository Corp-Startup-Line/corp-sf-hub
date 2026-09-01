"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { QUOTA } from "../lib/data";
import { DIAL_TARGET_PER_DAY, DEMO_TARGET_PER_WEEK, DIALING_DAYS_PER_WEEK } from "../lib/repTargets";

// Ported from the SFCR Dashboard mockup (SFCR Dashboard.dc.html). Colors and
// layout are kept as literal inline styles to match that design 1:1, rather
// than translated into this app's Tailwind/corgi-ginger theme.

type Cell = { value: string; pace: string; behind: boolean };
type Metric = { name: string; note: string; daily: Cell; weekly: Cell; monthly: Cell };
// dials/demos/cpd are undefined for AEs — /api/sf-metrics tracks no call/meeting
// activity for AEs, only ARR (see the AE integration note below).
type RepRow = { name: string; role: "BDR" | "AE"; dials?: number; demos?: number; cpd?: number; arr: number };
type RankedRep = RepRow & { rank: number };
type Group = { label: string; showLabel: boolean; note?: string; reps: RankedRep[] };

const cell = (value: string, pace: string, behind: boolean): Cell => ({ value, pace, behind });

// "$207.5K" / "$1.24M" — one or two decimals, dropped when the number is round.
function fmtArr(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(2)}M`;
  }
  const k = n / 1000;
  return `$${Number.isInteger(k) ? String(k) : k.toFixed(1)}K`;
}

// Shape of the fields we read off GET /api/sf-metrics for the rows wired up so
// far (see app/api/sf-metrics/route.ts). The rest of that payload is ignored
// here for now — remaining rows are still sample data, wired up one by one.
type RepMetric = {
  name?: string;
  dials?: number;
  dialsWeek?: number;
  dialsMonth?: number;
  demosToday?: number;
  demosWk?: number;
  demosMonth?: number;
  stage?: "ramp" | "steady";
  series?: { arr?: number[] }; // weekly ARR series, oldest → newest
  arrMo?: number; // ARR closed this month
  dealsMo?: number; // deals closed this month
  pipelineVal?: number; // current open (not Closed Won/Lost) pipeline value — a snapshot
  showRate?: number; // held ÷ booked meetings THIS WEEK ONLY (see BDR_RANKING note below)
};
// AEs get no dials/demos/showRate from /api/sf-metrics — only ARR (see aeMine
// in app/api/sf-metrics/route.ts: AE money = deals they own or self-sourced;
// no call/meeting activity is tracked per AE anywhere in that route).
type AeMetric = {
  name?: string;
  series?: { obArr?: number[]; ibArr?: number[] }; // weekly, oldest → newest
  obArrMo?: number; // outbound ARR closed this month
  ibArrMo?: number; // inbound ARR closed this month
};
type SfMetrics = {
  team?: { arr?: number[] };
  teamMonth?: { arrMo?: number };
  teamToday?: { arr?: number };
  workDaysElapsed?: number;
  weeksInMonth?: number;
  reps?: RepMetric[];
  aes?: AeMetric[];
  updatedAt?: string; // when the server last (re)built this payload
};

const PACIFIC_TZ = "America/Los_Angeles";

// "8:04 AM PT" — when /api/sf-metrics last rebuilt its cache.
function fmtSyncedTime(iso: string): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
  return `${time} PT`;
}

// "Mon 31 Aug 2026" — today's date, Pacific (matches the rest of this app's
// Pacific-anchored day/week boundaries).
function fmtHeaderDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}


// BDR RANKING FORMULA (Business Development group, Split view only — see the
// Rep Leaderboard section below). Weighted composite of month-to-date ARR,
// month-to-date deals closed, current open-pipeline value, and qualified demos
// booked-and-showed. Each component is normalized as "this rep's share of the
// team total" before weighting, so different-unit metrics (dollars, counts,
// dollars again, counts) combine on a comparable 0–1 scale.
//
// CAVEAT: the "demos booked and showed" component is approximated as
// demosMonth × showRate, but showRate only reflects THIS WEEK's meeting
// outcomes (see /api/sf-metrics: mtgBookedById/mtgHeldById are scoped to
// curWkStart..curWkEnd, no monthly history) — so today, this component reads
// 0 for every rep until HubSpot has logged this week's meeting outcomes. Until
// then the formula is effectively ARR 40 / Deals 30 / Pipeline 17 out of 87,
// with the 13% simply contributing nothing to anyone (not favoring one rep
// over another).
const BDR_RANKING_WEIGHTS = { arr: 0.4, deals: 0.3, pipeline: 0.17, demosShown: 0.13 };

function bdrRankingScore(reps: RepMetric[]): Map<string, number> {
  const shareOf = (pick: (r: RepMetric) => number) => {
    const total = reps.reduce((s, r) => s + pick(r), 0) || 1;
    return (r: RepMetric) => pick(r) / total;
  };
  const arrShare = shareOf((r) => r.arrMo ?? 0);
  const dealsShare = shareOf((r) => r.dealsMo ?? 0);
  const pipelineShare = shareOf((r) => r.pipelineVal ?? 0);
  const demosShownShare = shareOf((r) => (r.demosMonth ?? 0) * (r.showRate ?? 0));

  return new Map(
    reps.map((r) => [
      r.name ?? "",
      BDR_RANKING_WEIGHTS.arr * arrShare(r) +
        BDR_RANKING_WEIGHTS.deals * dealsShare(r) +
        BDR_RANKING_WEIGHTS.pipeline * pipelineShare(r) +
        BDR_RANKING_WEIGHTS.demosShown * demosShownShare(r),
    ]),
  );
}

// Pace targets are derived from the existing monthly/annual QUOTA (app/lib/data.ts)
// rather than tracked separately: monthly target = QUOTA.teamMonthly; weekly =
// that ÷ ~4.33 weeks/month; daily = that ÷ working (Mon–Fri) days elapsed so far
// this month (from the server, which already knows the Pacific calendar).
function pace(actual: number | undefined, target: number | undefined): { text: string; behind: boolean } {
  if (actual == null || !target) return { text: "", behind: false };
  const pct = Math.round((actual / target) * 100);
  return { text: `${pct}% of pace`, behind: pct < 100 };
}

// Calls Per Demo is a "lower is better" ratio, so it reads against a fixed
// target number rather than a "% of pace" (matching the mockup's "Target 55"
// styling) and flags "behind" when actual is ABOVE target, not below.
function paceLowerBetter(actual: number | undefined, target: number | undefined): { text: string; behind: boolean } {
  if (actual == null || !target) return { text: "", behind: false };
  return { text: `Target ${Math.round(target)}`, behind: actual > target };
}

// Show Rate: /api/sf-metrics only computes ONE current-week snapshot per rep
// (one meetings query scoped to curWkStart..curWkEnd — no day-by-day breakdown,
// no history across other weeks, unlike Dials/Demos which have full series).
// So none of the three tiers can be shown live yet — dashes instead of the
// mockup's fake numbers until that backend work happens.
const SAMPLE_METRICS: Metric[] = [
  {
    name: "Show Rate",
    note: "Held ÷ booked, HubSpot outcomes",
    daily: cell("—", "", false),
    weekly: cell("—", "", false),
    monthly: cell("—", "", false),
  },
];

const ALERTS = [
  { text: "Dials 9% behind pace today — 3 reps under 60 by noon." },
  { text: "Monthly ARR needs $164K in 1 business day." },
  { text: "Rae Lindqvist at 78 calls per demo, 42% above team." },
];

function byArr(a: RepRow, b: RepRow) {
  return b.arr - a.arr;
}

function rank(list: RepRow[]): RankedRep[] {
  return list.map((r, i) => ({ ...r, rank: i + 1 }));
}

// Last entry in a weekly series (oldest → newest) = the current week.
function lastOf(series: number[] | undefined): number {
  return series?.length ? series[series.length - 1] : 0;
}

const paceDot = (behind: boolean) => (
  <span style={{ width: 6, height: 6, background: behind ? "#FF6B35" : "#CFC8BE", flexShrink: 0 }} />
);

function MetricCell({ value, pace, behind }: Cell) {
  return (
    <div style={{ padding: "20px 24px", borderLeft: "1px solid #E4DED4", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
      {pace && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {paceDot(behind)}
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8A8279" }}>
            {pace}
          </span>
        </div>
      )}
    </div>
  );
}

const colHeader: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#8A8279",
};

export default function SfcrDashboardPage() {
  const [split, setSplit] = useState(false);
  const [sfMetrics, setSfMetrics] = useState<SfMetrics | null>(null);
  // Filled in client-side only (like Header.tsx's "Last updated") so the
  // server-rendered HTML never has to guess "now" and mismatch on hydration.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Live ARR feed — same endpoint the real Pipeline dashboard uses. Re-pulled
  // every 3 minutes, matching Dashboard.tsx's refresh cadence.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/sf-metrics")
        .then((r) => r.json())
        .then((d: SfMetrics) => {
          if (alive) setSfMetrics(d);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 3 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const arrRow: Metric = useMemo(() => {
    const daily = sfMetrics?.teamToday?.arr;
    const weeklySeries = sfMetrics?.team?.arr;
    const weekly = weeklySeries?.length ? weeklySeries[weeklySeries.length - 1] : undefined;
    const monthly = sfMetrics?.teamMonth?.arrMo;
    const workDays = sfMetrics?.workDaysElapsed;

    const monthlyTarget = QUOTA.teamMonthly;
    const weeklyTarget = QUOTA.teamMonthly / 4.33;
    const dailyTarget = workDays ? QUOTA.teamMonthly / workDays : undefined;

    const dailyPace = pace(daily, dailyTarget);
    const weeklyPace = pace(weekly, weeklyTarget);
    const monthlyPace = pace(monthly, monthlyTarget);

    return {
      name: "ARR",
      note: "Closed-won, HubSpot deal value",
      daily: cell(daily != null ? fmtArr(daily) : "—", dailyPace.text, dailyPace.behind),
      weekly: cell(weekly != null ? fmtArr(weekly) : "—", weeklyPace.text, weeklyPace.behind),
      monthly: cell(monthly != null ? fmtArr(monthly) : "—", monthlyPace.text, monthlyPace.behind),
    };
  }, [sfMetrics]);

  const dialsRow: Metric = useMemo(() => {
    const reps = sfMetrics?.reps ?? [];
    const sum = (pick: (r: RepMetric) => number | undefined) =>
      reps.length ? reps.reduce((s, r) => s + (pick(r) ?? 0), 0) : undefined;
    const daily = sum((r) => r.dials);
    const weekly = sum((r) => r.dialsWeek);
    const monthly = sum((r) => r.dialsMonth);

    const dailyTarget = reps.length
      ? reps.reduce((s, r) => s + DIAL_TARGET_PER_DAY[r.stage === "ramp" ? "ramp" : "steady"], 0)
      : undefined;
    const weeklyTarget = dailyTarget != null ? dailyTarget * DIALING_DAYS_PER_WEEK : undefined;
    const weeksInMonth = sfMetrics?.weeksInMonth;
    const monthlyTarget = weeklyTarget != null && weeksInMonth ? weeklyTarget * weeksInMonth : undefined;

    const dailyPace = pace(daily, dailyTarget);
    const weeklyPace = pace(weekly, weeklyTarget);
    const monthlyPace = pace(monthly, monthlyTarget);
    const fmt = (n: number) => n.toLocaleString("en-US");

    return {
      name: "Dials",
      note: "Connected + attempted calls",
      daily: cell(daily != null ? fmt(daily) : "—", dailyPace.text, dailyPace.behind),
      weekly: cell(weekly != null ? fmt(weekly) : "—", weeklyPace.text, weeklyPace.behind),
      monthly: cell(monthly != null ? fmt(monthly) : "—", monthlyPace.text, monthlyPace.behind),
    };
  }, [sfMetrics]);

  const demosRow: Metric = useMemo(() => {
    const reps = sfMetrics?.reps ?? [];
    const sum = (pick: (r: RepMetric) => number | undefined) =>
      reps.length ? reps.reduce((s, r) => s + (pick(r) ?? 0), 0) : undefined;
    const daily = sum((r) => r.demosToday);
    const weekly = sum((r) => r.demosWk);
    const monthly = sum((r) => r.demosMonth);

    const weeklyTarget = reps.length
      ? reps.reduce((s, r) => s + DEMO_TARGET_PER_WEEK[r.stage === "ramp" ? "ramp" : "steady"], 0)
      : undefined;
    const dailyTarget = weeklyTarget != null ? weeklyTarget / DIALING_DAYS_PER_WEEK : undefined;
    const weeksInMonth = sfMetrics?.weeksInMonth;
    const monthlyTarget = weeklyTarget != null && weeksInMonth ? weeklyTarget * weeksInMonth : undefined;

    const dailyPace = pace(daily, dailyTarget);
    const weeklyPace = pace(weekly, weeklyTarget);
    const monthlyPace = pace(monthly, monthlyTarget);
    const fmt = (n: number) => n.toLocaleString("en-US");

    return {
      name: "Demos Booked",
      note: "Meetings set by BDRs + AEs",
      daily: cell(daily != null ? fmt(daily) : "—", dailyPace.text, dailyPace.behind),
      weekly: cell(weekly != null ? fmt(weekly) : "—", weeklyPace.text, weeklyPace.behind),
      monthly: cell(monthly != null ? fmt(monthly) : "—", monthlyPace.text, monthlyPace.behind),
    };
  }, [sfMetrics]);

  // Calls Per Demo = Dials ÷ Demos Booked at each tier — no new server field
  // needed, just the same rep-level dials/demos already summed above. The
  // target ratio is (dial target ÷ demo target) — algebraically the same
  // number at every tier since both targets scale by the same day/week/month
  // factors, so it's computed once off the weekly targets.
  const cpdRow: Metric = useMemo(() => {
    const reps = sfMetrics?.reps ?? [];
    const sum = (pick: (r: RepMetric) => number | undefined) =>
      reps.length ? reps.reduce((s, r) => s + (pick(r) ?? 0), 0) : undefined;
    const ratio = (n: number | undefined, d: number | undefined) => (n != null && d ? n / d : undefined);

    const dialsDaily = sum((r) => r.dials);
    const dialsWeekly = sum((r) => r.dialsWeek);
    const dialsMonthly = sum((r) => r.dialsMonth);
    const demosDaily = sum((r) => r.demosToday);
    const demosWeekly = sum((r) => r.demosWk);
    const demosMonthly = sum((r) => r.demosMonth);

    const daily = ratio(dialsDaily, demosDaily);
    const weekly = ratio(dialsWeekly, demosWeekly);
    const monthly = ratio(dialsMonthly, demosMonthly);

    const dialWeeklyTarget = reps.length
      ? reps.reduce((s, r) => s + DIAL_TARGET_PER_DAY[r.stage === "ramp" ? "ramp" : "steady"], 0) * DIALING_DAYS_PER_WEEK
      : undefined;
    const demoWeeklyTarget = reps.length
      ? reps.reduce((s, r) => s + DEMO_TARGET_PER_WEEK[r.stage === "ramp" ? "ramp" : "steady"], 0)
      : undefined;
    const targetRatio = ratio(dialWeeklyTarget, demoWeeklyTarget);

    const dailyPace = paceLowerBetter(daily, targetRatio);
    const weeklyPace = paceLowerBetter(weekly, targetRatio);
    const monthlyPace = paceLowerBetter(monthly, targetRatio);
    const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

    return {
      name: "Calls Per Demo",
      note: "Dials ÷ demos booked · lower is better",
      daily: cell(daily != null ? fmt(daily) : "—", dailyPace.text, dailyPace.behind),
      weekly: cell(weekly != null ? fmt(weekly) : "—", weeklyPace.text, weeklyPace.behind),
      monthly: cell(monthly != null ? fmt(monthly) : "—", monthlyPace.text, monthlyPace.behind),
    };
  }, [sfMetrics]);

  // Fixed display order; each row comes from either a live computation above or
  // a still-sample entry in SAMPLE_METRICS, keyed by name so wiring up the next
  // row is just adding one more entry here.
  const ROW_ORDER = ["ARR", "Demos Booked", "Dials", "Calls Per Demo", "Show Rate"];
  const rowsByName: Record<string, Metric> = {
    ARR: arrRow,
    Dials: dialsRow,
    "Demos Booked": demosRow,
    "Calls Per Demo": cpdRow,
    ...Object.fromEntries(SAMPLE_METRICS.map((m) => [m.name, m])),
  };
  const metricRows: Metric[] = ROW_ORDER.map((name) => rowsByName[name]);

  // BDR rows: week-to-date Dials/Demos/Calls-per-Demo/ARR, straight off the same
  // per-rep fields the metric rows above already sum across the team.
  const bdrRows: RepRow[] = useMemo(
    () =>
      (sfMetrics?.reps ?? []).map((r) => {
        // Month-to-date, matching the BDR ranking formula's own period — a rep
        // ranked #1 off this month's numbers should show numbers to match,
        // not a week-to-date column that reads 0 for anyone who closed early.
        const dials = r.dialsMonth;
        const demos = r.demosMonth;
        return {
          name: r.name ?? "—",
          role: "BDR" as const,
          dials,
          demos,
          cpd: dials != null && demos ? Math.round(dials / demos) : undefined,
          arr: r.arrMo ?? 0,
        };
      }),
    [sfMetrics],
  );

  // AE rows: ARR only — no dials/demos/show-rate is tracked per AE anywhere in
  // /api/sf-metrics (see the AeMetric comment above), so those cells show "—".
  // Month-to-date ARR, same period as the BDR rows above, so Combined view
  // (which merges both) isn't mixing weekly and monthly numbers in one column.
  const aeRows: RepRow[] = useMemo(
    () =>
      (sfMetrics?.aes ?? []).map((a) => ({
        name: a.name ?? "—",
        role: "AE" as const,
        dials: undefined,
        demos: undefined,
        cpd: undefined,
        arr: (a.obArrMo ?? 0) + (a.ibArrMo ?? 0),
      })),
    [sfMetrics],
  );

  // BDR ranking formula only applies within the Business Development group
  // (Split view) — Combined view stays a straight cross-role ARR comparison,
  // and AEs keep their ARR-only sort (no deals/pipeline/demos formula defined
  // for them).
  const bdrScoreByName = useMemo(() => bdrRankingScore(sfMetrics?.reps ?? []), [sfMetrics]);
  const byBdrScore = (a: RepRow, b: RepRow) => (bdrScoreByName.get(b.name) ?? 0) - (bdrScoreByName.get(a.name) ?? 0);

  const groups: Group[] = useMemo(
    () =>
      split
        ? [
            {
              label: "Business Development",
              showLabel: true,
              note: "Ranked by weighted score — ARR 40% · deals closed 30% · pipeline 17% · demos booked & showed 13%",
              reps: rank([...bdrRows].sort(byBdrScore)),
            },
            { label: "Account Executives", showLabel: true, reps: rank([...aeRows].sort(byArr)) },
          ]
        : [{ label: "All reps", showLabel: false, reps: rank([...bdrRows, ...aeRows].sort(byArr)) }],
    [split, bdrRows, aeRows, bdrScoreByName],
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F7F4EF",
        color: "#111111",
        fontFamily: "'Archivo', system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 32,
          padding: "24px 32px 16px",
          borderBottom: "2px solid #111111",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 10, height: 22, background: "#FF6B35" }} />
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>S.F.C.R.</div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8A8279" }}>
            Corgi Insurance · San Francisco Control Room
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, background: "#FF6B35" }} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>Live · HubSpot</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A8279" }}>
            {sfMetrics?.updatedAt ? `Synced ${fmtSyncedTime(sfMetrics.updatedAt)}` : "Syncing…"}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {now ? fmtHeaderDate(now) : ""}
          </div>
        </div>
      </header>

      <section style={{ padding: "0 32px", background: "#FFFFFF", borderBottom: "2px solid #111111" }}>
        <div style={{ display: "grid", gridTemplateColumns: "260px repeat(3, 1fr)", borderBottom: "2px solid #111111" }}>
          <div style={{ padding: "14px 0 12px", ...colHeader }}>Metric</div>
          {[
            { label: "Daily", sub: "Today · Aug 31" },
            { label: "Weekly", sub: "Week of Aug 31" },
            { label: "Monthly", sub: "August 2026" },
          ].map((h) => (
            <div key={h.label} style={{ padding: "14px 24px 12px", borderLeft: "1px solid #E4DED4" }}>
              <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{h.label}</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: "#8A8279", marginTop: 3 }}>{h.sub}</div>
            </div>
          ))}
        </div>

        {metricRows.map((m) => (
          <div
            key={m.name}
            style={{ display: "grid", gridTemplateColumns: "260px repeat(3, 1fr)", borderBottom: "1px solid #E4DED4", alignItems: "stretch" }}
          >
            <div style={{ padding: "22px 24px 22px 0", display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>{m.name}</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: "#8A8279", letterSpacing: "0.04em" }}>{m.note}</div>
            </div>
            <MetricCell {...m.daily} />
            <MetricCell {...m.weekly} />
            <MetricCell {...m.monthly} />
          </div>
        ))}
      </section>

      <section style={{ padding: "40px 32px 48px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 24,
            paddingBottom: 12,
            borderBottom: "2px solid #111111",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em" }}>Rep Leaderboard</h2>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A8279" }}>
              Month to date
            </span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              onClick={() => setSplit(false)}
              style={{
                border: "1px solid #111111",
                background: !split ? "#111111" : "transparent",
                color: !split ? "#F7F4EF" : "#111111",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "7px 14px",
                cursor: "pointer",
              }}
            >
              Combined
            </button>
            <button
              type="button"
              onClick={() => setSplit(true)}
              style={{
                border: "1px solid #111111",
                background: split ? "#111111" : "transparent",
                color: split ? "#F7F4EF" : "#111111",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "7px 14px",
                cursor: "pointer",
              }}
            >
              Split BDR / AE
            </button>
          </div>
        </div>

        {groups.map((g) => (
          <div key={g.label} style={{ marginTop: 28 }}>
            {g.showLabel && (
              <div style={{ paddingBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8A8279" }}>
                  {g.label}
                </div>
                {g.note && (
                  <div style={{ fontSize: 11, fontWeight: 500, color: "#A9A199", marginTop: 2 }}>{g.note}</div>
                )}
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "48px minmax(180px, 1.4fr) 90px repeat(4, 1fr)",
                borderBottom: "1px solid #111111",
                paddingBottom: 8,
              }}
            >
              <div style={colHeader}>#</div>
              <div style={colHeader}>Rep</div>
              <div style={colHeader}>Role</div>
              <div style={{ ...colHeader, textAlign: "right" }}>Dials</div>
              <div style={{ ...colHeader, textAlign: "right" }}>Demos</div>
              <div style={{ ...colHeader, textAlign: "right" }}>Calls / Demo</div>
              <div style={{ ...colHeader, textAlign: "right" }}>ARR</div>
            </div>
            {g.reps.map((r) => (
              <div
                key={r.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "48px minmax(180px, 1.4fr) 90px repeat(4, 1fr)",
                  alignItems: "center",
                  borderBottom: "1px solid #E4DED4",
                  padding: "14px 0",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "#A9A199" }}>{r.rank}</div>
                <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>{r.name}</div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A8279" }}>
                  {r.role}
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {r.dials != null ? r.dials.toLocaleString("en-US") : "—"}
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {r.demos != null ? r.demos.toLocaleString("en-US") : "—"}
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {r.cpd != null ? r.cpd.toLocaleString("en-US") : "—"}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {fmtArr(r.arr)}
                </div>
              </div>
            ))}
          </div>
        ))}

        <div
          style={{
            marginTop: 32,
            borderTop: "2px solid #111111",
            paddingTop: 14,
            display: "flex",
            flexWrap: "wrap",
            gap: "12px 28px",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#FF6B35" }}>
            Needs your eyes
          </span>
          {ALERTS.map((a) => (
            <span key={a.text} style={{ fontSize: 12, fontWeight: 500, color: "#3D3833" }}>
              {a.text}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
