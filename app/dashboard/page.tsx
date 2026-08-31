"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { QUOTA } from "../lib/data";

// Ported from the SFCR Dashboard mockup (SFCR Dashboard.dc.html). Colors and
// layout are kept as literal inline styles to match that design 1:1, rather
// than translated into this app's Tailwind/corgi-ginger theme.

type Cell = { value: string; pace: string; behind: boolean };
type Metric = { name: string; note: string; daily: Cell; weekly: Cell; monthly: Cell };
type RepBase = { name: string; role: "BDR" | "AE"; dials: number; demos: number; cpd: number; arr: string };
type Rep = RepBase & { rank: number };
type Group = { label: string; showLabel: boolean; reps: Rep[] };

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

// Shape of the fields we read off GET /api/sf-metrics for the ARR row (see
// app/api/sf-metrics/route.ts). Rest of that payload is ignored here for now —
// the other four metric rows below are still sample data, wired up one by one.
type SfMetrics = {
  team?: { arr?: number[] };
  teamMonth?: { arrMo?: number };
  teamToday?: { arr?: number };
  workDaysElapsed?: number;
};

// Pace targets are derived from the existing monthly/annual QUOTA (app/lib/data.ts)
// rather than tracked separately: monthly target = QUOTA.teamMonthly; weekly =
// that ÷ ~4.33 weeks/month; daily = that ÷ working (Mon–Fri) days elapsed so far
// this month (from the server, which already knows the Pacific calendar).
function pace(actual: number | undefined, target: number | undefined): { text: string; behind: boolean } {
  if (actual == null || !target) return { text: "", behind: false };
  const pct = Math.round((actual / target) * 100);
  return { text: `${pct}% of pace`, behind: pct < 100 };
}

// Still-sample rows — Demos Booked, Dials, Calls Per Demo, Show Rate. ARR (the
// first row) is built live from /api/sf-metrics in the component below.
const SAMPLE_METRICS: Metric[] = [
  {
    name: "Demos Booked",
    note: "Meetings set by BDRs + AEs",
    daily: cell("7", "117% of pace", false),
    weekly: cell("41", "102% of pace", false),
    monthly: cell("168", "105% of pace", false),
  },
  {
    name: "Dials",
    note: "Connected + attempted calls",
    daily: cell("412", "91% of pace", true),
    weekly: cell("2,190", "96% of pace", false),
    monthly: cell("8,940", "99% of pace", false),
  },
  {
    name: "Calls Per Demo",
    note: "Dials ÷ demos booked · lower is better",
    daily: cell("59", "Target 55", true),
    weekly: cell("53", "Target 55", false),
    monthly: cell("53", "Target 55", false),
  },
  {
    name: "Show Rate",
    note: "Held ÷ booked, HubSpot outcomes",
    daily: cell("71%", "Target 70%", false),
    weekly: cell("68%", "Target 70%", true),
    monthly: cell("72%", "Target 70%", false),
  },
];

const BDRS: RepBase[] = [
  { name: "Marisol Vega", role: "BDR", dials: 612, demos: 11, cpd: 56, arr: "$186K" },
  { name: "Devon Pryce", role: "BDR", dials: 548, demos: 9, cpd: 61, arr: "$142K" },
  { name: "Kofi Mensah", role: "BDR", dials: 501, demos: 8, cpd: 63, arr: "$121K" },
  { name: "Rae Lindqvist", role: "BDR", dials: 388, demos: 5, cpd: 78, arr: "$74K" },
];

const AES: RepBase[] = [
  { name: "Priya Anand", role: "AE", dials: 214, demos: 7, cpd: 31, arr: "$298K" },
  { name: "Jonah Reyes", role: "AE", dials: 190, demos: 6, cpd: 32, arr: "$241K" },
  { name: "Tom Castellano", role: "AE", dials: 137, demos: 4, cpd: 34, arr: "$118K" },
];

const ALERTS = [
  { text: "Dials 9% behind pace today — 3 reps under 60 by noon." },
  { text: "Monthly ARR needs $164K in 1 business day." },
  { text: "Rae Lindqvist at 78 calls per demo, 42% above team." },
];

function byArr(a: RepBase, b: RepBase) {
  return parseFloat(b.arr.replace(/[^0-9.]/g, "")) - parseFloat(a.arr.replace(/[^0-9.]/g, ""));
}

function rank(list: RepBase[]): Rep[] {
  return list.map((r, i) => ({ ...r, rank: i + 1 }));
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

  const metricRows: Metric[] = [arrRow, ...SAMPLE_METRICS];

  const groups: Group[] = useMemo(
    () =>
      split
        ? [
            { label: "Business Development", showLabel: true, reps: rank([...BDRS].sort(byArr)) },
            { label: "Account Executives", showLabel: true, reps: rank([...AES].sort(byArr)) },
          ]
        : [{ label: "All reps", showLabel: false, reps: rank([...BDRS, ...AES].sort(byArr)) }],
    [split],
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
            Synced 8:04 AM PT
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>Mon 31 Aug 2026</div>
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
              Week to date
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
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8A8279", paddingBottom: 8 }}>
                {g.label}
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
                <div style={{ fontSize: 16, fontWeight: 500, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.dials}</div>
                <div style={{ fontSize: 16, fontWeight: 500, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.demos}</div>
                <div style={{ fontSize: 16, fontWeight: 500, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.cpd}</div>
                <div style={{ fontSize: 16, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.arr}</div>
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
