"use client";

// ============================================================================
// LIGHTWEIGHT CHARTS  (app/components/Charts.tsx)
// Drawn by hand with SVG + divs — no chart library to install or break. Two of
// them: a "won value by month" trend line and a rep leaderboard bar chart.
// ============================================================================

import type { MonthPoint } from "../lib/data";
import { Card, SectionLabel, money, moneyFull } from "../lib/ui";

// "2026-03" -> "Mar". Just the short month name for compact axis labels.
function shortMonth(m: string): string {
  const [year, month] = m.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "short" });
}

// ---- Won value by month: clean vertical bars -------------------------------
// A line was the wrong shape for this data — most months are $0 with one big
// month, so a line just drew a lonely spike over a lot of empty space. Bars sit
// evenly across the card, fill the width, and the real numbers live ON the
// chart: each bar is labelled with its won value; the month and deal count sit
// underneath. Empty months are simply short, which reads as "quiet", not broken.
export function WonTrend({ data }: { data: MonthPoint[] }) {
  const max = Math.max(...data.map((d) => d.wonValue), 1);
  const hasData = data.some((d) => d.wonValue > 0);

  return (
    <Card>
      <SectionLabel>Won Value by Month</SectionLabel>
      {hasData ? (
        <div className="mt-6 flex h-44 w-full items-stretch gap-4">
          {data.map((d) => {
            const pct = (d.wonValue / max) * 100;
            return (
              <div
                key={d.month}
                className="flex flex-1 flex-col items-center"
                title={`${shortMonth(d.month)}: ${moneyFull(d.wonValue)} (${d.wonCount} won)`}
              >
                {/* bar area — grows from a shared baseline */}
                <div className="flex w-full flex-1 flex-col items-center justify-end">
                  {d.wonValue > 0 && (
                    <span className="mb-1.5 text-[11px] font-semibold tabular-nums text-corgi-ginger">
                      {money(d.wonValue)}
                    </span>
                  )}
                  <div
                    className="w-full max-w-[52px] rounded-t-lg bg-gradient-to-t from-corgi-ginger/60 to-corgi-ginger transition-[height] duration-700 ease-out"
                    style={{ height: `${pct}%`, minHeight: d.wonValue > 0 ? 4 : 0 }}
                  />
                </div>
                {/* month + deal count under the baseline */}
                <div className="mt-2.5 flex flex-col items-center gap-0.5">
                  <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                    {shortMonth(d.month)}
                  </span>
                  <span className="text-[9px] text-neutral-400">
                    {d.wonCount ? `${d.wonCount} won` : "—"}
                  </span>
                </div>
              </div>
            );
          })}
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
