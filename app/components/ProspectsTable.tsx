"use client";

import { useEffect, useMemo, useState } from "react";
import {
  STAGES,
  dealHealth,
  daysSinceContact,
  hubspotUrl,
  isQuoted,
  type DealHealth,
  type Prospect,
  type Stage,
} from "../lib/data";
import { SectionLabel, StageBadge, moneyFull, prettyDate } from "../lib/ui";

// Traffic-light styling for a row, by deal health. Kept restrained: a thin
// coloured left edge + a whisper-faint tint, never a loud fill. The tint goes
// on the whole row; the coloured edge goes on the first cell only.
// Base tint + a slightly stronger tint of the SAME hue on hover, so a coloured
// row keeps its colour when you mouse over it (never flips to another colour).
const HEALTH_BG: Record<DealHealth, string> = {
  won: "bg-emerald-700/[0.08] hover:bg-emerald-700/[0.14]",
  safe: "hover:bg-emerald-500/[0.05]",
  warning: "bg-amber-500/[0.05] hover:bg-amber-500/[0.10]",
  risk: "bg-rose-500/[0.05] hover:bg-rose-500/[0.10]",
  none: "hover:bg-black/[0.02] dark:hover:bg-white/5",
};

const HEALTH_EDGE: Record<DealHealth, string> = {
  won: "border-l-emerald-700",
  safe: "border-l-emerald-400/80",
  warning: "border-l-amber-400",
  risk: "border-l-rose-500",
  none: "border-l-transparent",
};

// Plain-English tooltip explaining why a row is coloured the way it is.
function healthTitle(p: Prospect): string {
  const h = dealHealth(p);
  if (h === "won") return "Closed Won";
  const d = daysSinceContact(p);
  if (d === null) return "No contact logged yet";
  const label = h === "risk" ? "At risk" : h === "warning" ? "Chase soon" : "On track";
  return `${label} — ${d} day${d === 1 ? "" : "s"} since last contact`;
}

// Solid dot colours for the little legend (the row tint is too faint for a dot).
const HEALTH_DOT: Record<DealHealth, string> = {
  won: "bg-emerald-700",
  safe: "bg-emerald-400",
  warning: "bg-amber-400",
  risk: "bg-rose-500",
  none: "bg-neutral-300",
};

const LEGEND: { health: DealHealth; label: string }[] = [
  { health: "safe", label: "On track" },
  { health: "warning", label: "Chase soon" },
  { health: "risk", label: "At risk" },
  { health: "won", label: "Won" },
];

// Which columns you can sort by, and how to read each value out of a row.
type SortKey = "company" | "stage" | "bdr" | "ae" | "lastContact" | "quote";

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "stage", label: "Stage" },
  { key: "bdr", label: "BDR" },
  { key: "ae", label: "AE" },
  { key: "lastContact", label: "Last Positive Contact" },
  { key: "quote", label: "Quote" },
  { key: null, label: "Notes" },
];

export default function ProspectsTable({
  rows,
  wonOnly,
  sortByWon,
  stageFilter,
  onStageFilter,
}: {
  rows: Prospect[];
  wonOnly: boolean;
  sortByWon: boolean;
  stageFilter: Stage | "all";
  onStageFilter: (s: Stage | "all") => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("company");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // When you click the "Closed Won Value" card, jump to quote (high → low).
  useEffect(() => {
    if (sortByWon) {
      setSortKey("quote");
      setSortDir("desc");
    }
  }, [sortByWon]);

  // Click a header: same column flips direction, new column starts ascending.
  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Filter (stage + won-only + search), then sort. useMemo = only recompute when inputs change.
  const processed = useMemo(() => {
    // Match the exact stage picked (not cumulative) — the table shows only
    // deals sitting in that stage right now. "Quoted" is special: it means
    // "has a real Corgi/Django quote", so it matches the funnel's Quoted card.
    let out =
      stageFilter === "all"
        ? rows
        : stageFilter === "Quoted"
          ? rows.filter(isQuoted)
          : rows.filter((r) => r.stage === stageFilter);
    if (wonOnly) out = out.filter((r) => r.stage === "Closed Won");

    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (r) =>
          r.company.toLowerCase().includes(q) ||
          r.contact.toLowerCase().includes(q) ||
          r.notes.toLowerCase().includes(q),
      );
    }

    const sorted = [...out].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, wonOnly, stageFilter, search, sortKey, sortDir]);

  // Pagination maths.
  const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = processed.slice(start, start + pageSize);

  // Whenever the underlying data or page size changes, go back to page 1.
  useEffect(() => setPage(1), [rows, wonOnly, stageFilter, search, pageSize]);

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>Deals ({processed.length})</SectionLabel>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
            {LEGEND.map((l) => (
              <span key={l.health} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${HEALTH_DOT[l.health]}`} />
                {l.label}
              </span>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, contact, notes…"
            className="w-64 rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-emerald-500/40 dark:border-white/15 dark:bg-white/10"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/50 bg-gradient-to-b from-white/60 to-white/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-16px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.12] dark:from-white/[0.08] dark:to-white/[0.03]">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wider text-neutral-500 dark:border-white/10 dark:text-neutral-400">
              {COLUMNS.map((c) => (
                <th key={c.label} className="px-4 py-3 font-medium">
                  {c.key === "stage" ? (
                    // Stage gets a dropdown filter instead of a sort toggle —
                    // it drives the same stage filter the funnel cards use, so
                    // it stays in sync on the main page and per-BDR alike.
                    <label className="inline-flex items-center gap-1">
                      <span>Stage</span>
                      <select
                        value={stageFilter}
                        onChange={(e) =>
                          onStageFilter(e.target.value as Stage | "all")
                        }
                        title="Filter by stage"
                        className={`cursor-pointer rounded-md border px-1.5 py-0.5 text-xs uppercase tracking-wider outline-none transition focus:ring-2 focus:ring-corgi-ginger/40 dark:bg-white/10 ${
                          stageFilter === "all"
                            ? "border-black/10 bg-white/70 text-neutral-500 dark:border-white/15 dark:text-neutral-400"
                            : "border-corgi-ginger/40 bg-corgi-ginger/10 text-corgi-ginger"
                        }`}
                      >
                        <option value="all">All</option>
                        {STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : c.key ? (
                    <button
                      onClick={() => toggleSort(c.key!)}
                      className="inline-flex items-center gap-1 transition hover:text-neutral-800 dark:hover:text-neutral-200"
                    >
                      {c.label}
                      {sortKey === c.key && (
                        <span>{sortDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const h = dealHealth(r);
              return (
              <tr
                key={r.id}
                title={healthTitle(r)}
                className={`border-b border-black/5 transition last:border-0 dark:border-white/5 ${HEALTH_BG[h]}`}
              >
                <td className={`border-l-[3px] px-4 py-3 font-medium ${HEALTH_EDGE[h]}`}>
                  <a
                    href={hubspotUrl(r)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-2 transition hover:text-corgi-ginger hover:underline"
                  >
                    {r.company}
                  </a>
                </td>
                <td className="px-4 py-3">
                  <StageBadge stage={r.stage} />
                </td>
                <td className="px-4 py-3">{r.bdr}</td>
                <td className="px-4 py-3">{r.ae}</td>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                  {prettyDate(r.lastContact)}
                </td>
                <td className="px-4 py-3 tabular-nums">{moneyFull(r.quote)}</td>
                <td className="max-w-[220px] truncate px-4 py-3 text-neutral-500 dark:text-neutral-400">
                  {r.notes}
                </td>
              </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-4 py-10 text-center text-neutral-400"
                >
                  No deals match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-lg border border-black/10 bg-white/70 px-2 py-1 dark:border-white/15 dark:bg-white/10"
          >
            {[25, 50, 75].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="rounded-lg border border-black/10 px-3 py-1 transition enabled:hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:enabled:hover:bg-white/10"
          >
            Prev
          </button>
          <span className="text-neutral-500 dark:text-neutral-400">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="rounded-lg border border-black/10 px-3 py-1 transition enabled:hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:enabled:hover:bg-white/10"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
