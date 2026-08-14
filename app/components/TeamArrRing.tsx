"use client";

// Live "Total Team ARR" donut for the front-door landing page. Pulls the same
// /api/sf-metrics feed the Metrics dashboard uses and shows how much of the
// monthly office ARR goal the SF BDR team has sourced this month, split into
// outbound (ginger) and inbound (blue) arcs sweeping clockwise from the top.
import { useEffect, useState } from "react";

const GOAL = 650000; // fixed monthly office ARR target (matches OFFICE_ARR_GOAL)

type Rep = { obArrMo?: number; ibArrMo?: number };
type Metrics = { reps?: Rep[]; teamMonth?: { obArrMo?: number; ibArrMo?: number } };

// "$207.5K" — one decimal, dropped when it's a round thousand ("$650K").
function usdk(n: number): string {
  const k = n / 1000;
  const s = Number.isInteger(k) ? String(k) : k.toFixed(1);
  return `$${s}K`;
}

export default function TeamArrRing() {
  const [data, setData] = useState<{ outbound: number; inbound: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/sf-metrics")
      .then((r) => r.json())
      .then((d: Metrics) => {
        if (!alive) return;
        // Prefer the stable team-level total (every Closed-Won deal this month,
        // counted once) so the ring never shifts when someone moves BDR↔AE.
        // Fall back to summing the BDR reps for older payloads without teamMonth.
        const reps = d.reps ?? [];
        const tm = d.teamMonth;
        const outbound = tm?.obArrMo ?? reps.reduce((s, r) => s + (r.obArrMo ?? 0), 0);
        const inbound = tm?.ibArrMo ?? reps.reduce((s, r) => s + (r.ibArrMo ?? 0), 0);
        setData({ outbound, inbound });
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // The HubSpot feed can take ~25s to answer on a cold load, so distinguish
  // "still fetching" from a real $0 — otherwise the ring looks broken/empty.
  const loading = data === null && !failed;
  const outbound = data?.outbound ?? 0;
  const inbound = data?.inbound ?? 0;
  const total = outbound + inbound;
  // Show a dash placeholder for money figures until the real numbers land.
  const money = (v: number) => (data ? usdk(v) : "$—");
  const ratio = Math.min(1, total / GOAL);
  const pct = Math.round(ratio * 100);

  // Two stacked arcs that together fill the ring to `ratio` of the goal.
  const R = 92;
  const C = 2 * Math.PI * R;
  const cap = (v: number) => Math.max(0, Math.min(1, v / GOAL));
  let outF = cap(outbound);
  let inF = cap(inbound);
  if (outF + inF > 1) {
    const s = 1 / (outF + inF);
    outF *= s;
    inF *= s;
  }
  const outLen = outF * C;
  const inLen = inF * C;

  return (
    <div className="mx-auto mb-12 w-full max-w-sm rounded-3xl border border-white/50 bg-gradient-to-b from-white/70 to-white/35 p-8 text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-14px_rgba(0,0,0,0.22)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.12] dark:from-white/[0.10] dark:to-white/[0.03] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_12px_34px_-14px_rgba(0,0,0,0.55)]">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
        Total Team ARR · This Month
      </div>

      <div className="relative mx-auto mt-6 h-[220px] w-[220px]">
        <svg viewBox="0 0 220 220" className="h-[220px] w-[220px]">
          <circle
            cx={110}
            cy={110}
            r={R}
            className="fill-none [stroke:rgba(0,0,0,0.09)] dark:[stroke:rgba(255,255,255,0.12)]"
            strokeWidth={16}
          />
          <g transform="rotate(-90 110 110)">
            <circle
              cx={110}
              cy={110}
              r={R}
              fill="none"
              stroke="#c9762f"
              strokeWidth={16}
              strokeLinecap="butt"
              strokeDasharray={`${outLen} ${C - outLen}`}
              style={{ transition: "stroke-dasharray .7s ease" }}
            />
            <circle
              cx={110}
              cy={110}
              r={R}
              fill="none"
              stroke="#4d9bff"
              strokeWidth={16}
              strokeLinecap="butt"
              strokeDasharray={`${inLen} ${C - inLen}`}
              strokeDashoffset={-outLen}
              style={{ transition: "stroke-dasharray .7s ease, stroke-dashoffset .7s ease" }}
            />
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div
            className={`text-5xl font-bold tracking-tight tabular-nums ${
              loading ? "animate-pulse text-neutral-300 dark:text-neutral-600" : ""
            }`}
          >
            {data ? `${pct}%` : failed ? "—" : "···"}
          </div>
          <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {loading ? "loading…" : failed ? "couldn't load" : "of monthly goal"}
          </div>
        </div>
      </div>

      <div className="mt-6 text-3xl font-semibold tracking-tight tabular-nums">
        <span className={loading ? "animate-pulse text-neutral-300 dark:text-neutral-600" : ""}>
          {money(total)}
        </span>{" "}
        <span className="font-medium text-neutral-400 dark:text-neutral-500">
          / {usdk(GOAL)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-[3px] bg-corgi-ginger" />
          <span className="text-neutral-500 dark:text-neutral-400">Outbound</span>
          <b className="tabular-nums">{money(outbound)}</b>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-[3px]" style={{ background: "#4d9bff" }} />
          <span className="text-neutral-500 dark:text-neutral-400">Inbound</span>
          <b className="tabular-nums">{money(inbound)}</b>
        </span>
      </div>
    </div>
  );
}
