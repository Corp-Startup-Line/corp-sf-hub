"use client";

// ============================================================================
// LIGHTWEIGHT CHARTS  (app/components/Charts.tsx)
// Drawn by hand with SVG + divs — no chart library to install or break. Two of
// them: a "won value by month" trend line and a rep leaderboard bar chart.
// ============================================================================

import type { MonthPoint, RepStat } from "../lib/data";
import { Card, SectionLabel, money, moneyFull } from "../lib/ui";

// "2026-03" -> "Mar". Just the short month name for compact axis labels.
function shortMonth(m: string): string {
  const [year, month] = m.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "short" });
}

// ---- Won value by month: a soft ginger area + line -------------------------
export function WonTrend({ data }: { data: MonthPoint[] }) {
  const W = 560;
  const H = 200;
  const P = 30; // padding inside the SVG so labels/dots aren't clipped
  const max = Math.max(...data.map((d) => d.wonValue), 1);
  const stepX = (W - P * 2) / Math.max(data.length - 1, 1);
  const x = (i: number) => P + i * stepX;
  const y = (v: number) => H - P - (v / max) * (H - P * 2);

  const linePts = data.map((d, i) => `${x(i)},${y(d.wonValue)}`).join(" ");
  const areaPts = `${x(0)},${H - P} ${linePts} ${x(data.length - 1)},${H - P}`;
  const hasData = data.some((d) => d.wonValue > 0);

  return (
    <Card>
      <SectionLabel>Won Value by Month</SectionLabel>
      {hasData ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img">
          <defs>
            <linearGradient id="wonFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-corgi-ginger)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--color-corgi-ginger)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* filled area under the line */}
          <polygon points={areaPts} fill="url(#wonFill)" />

          {/* the line itself */}
          <polyline
            points={linePts}
            fill="none"
            stroke="var(--color-corgi-ginger)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* dot + month label + value-on-hover for each point */}
          {data.map((d, i) => (
            <g key={d.month}>
              <circle cx={x(i)} cy={y(d.wonValue)} r={3.5} fill="var(--color-corgi-ginger)">
                <title>
                  {shortMonth(d.month)}: {moneyFull(d.wonValue)} ({d.wonCount} won)
                </title>
              </circle>
              <text
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-neutral-400 text-[10px]"
              >
                {shortMonth(d.month)}
              </text>
            </g>
          ))}
        </svg>
      ) : (
        <EmptyChart>No won deals in the current view.</EmptyChart>
      )}
    </Card>
  );
}

// ---- Rep leaderboard: horizontal bars, biggest closer first ----------------
export function RepLeaderboard({ stats, teamLabel }: { stats: RepStat[]; teamLabel: string }) {
  const ranked = [...stats]
    .filter((s) => s.wonValue > 0)
    .sort((a, b) => b.wonValue - a.wonValue);
  const max = Math.max(...ranked.map((s) => s.wonValue), 1);

  return (
    <Card>
      <SectionLabel>{teamLabel} Leaderboard (Won $)</SectionLabel>
      {ranked.length ? (
        <div className="mt-3 space-y-3">
          {ranked.map((r) => (
            <div key={r.name} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-sm">{r.name}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-corgi-ginger transition-[width] duration-700 ease-out"
                  style={{ width: `${(r.wonValue / max) * 100}%` }}
                  title={`${r.name}: ${moneyFull(r.wonValue)} (${r.wonCount} won)`}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-sm tabular-nums text-neutral-600 dark:text-neutral-300">
                {money(r.wonValue)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyChart>No won deals in the current view.</EmptyChart>
      )}
    </Card>
  );
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex h-40 items-center justify-center text-sm text-neutral-400">
      {children}
    </div>
  );
}
