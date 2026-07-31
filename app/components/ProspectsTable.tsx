"use client";

import { useEffect, useMemo, useState } from "react";
import {
  STAGES,
  dealHealth,
  daysSinceContact,
  lastPositiveContact,
  dealValue,
  hubspotUrl,
  effectiveStage,
  type DealHealth,
  type Prospect,
  type Stage,
} from "../lib/data";
import { SectionLabel, StageBadge, moneyFull, prettyDate } from "../lib/ui";
import { prettyMonth } from "../lib/month";

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
type SortKey =
  | "company"
  | "stage"
  | "bdr"
  | "ae"
  | "lastInbound"
  | "quote"
  | "lastContact";

// Plain-English tooltip for the engagement column, so it's clear what the date
// means.
const INBOUND_HINT =
  "Last time the customer reached in — a call that connected, or an email received from their contacts in HubSpot.";

// Plain-English tooltip for the rep-outbound column.
const OUTBOUND_HINT =
  "Last time the rep touched the deal — any logged activity (call, email, meeting/invite, or note), from HubSpot's Last Activity.";

// Stages offered in the Stage filter dropdown. The funnel no longer has a
// "Qualified" card, so the dropdown must not offer it either — otherwise you
// could filter to a stage the funnel doesn't show. Mirrors the funnel.
const FILTER_STAGES = STAGES.filter((s) => s !== "Qualified");

const COLUMNS: { key: SortKey | null; label: string; hint?: string }[] = [
  { key: "company", label: "Company" },
  { key: "stage", label: "Stage" },
  { key: "bdr", label: "BDR" },
  { key: "ae", label: "AE" },
  { key: "lastInbound", label: "Last Positive Contact", hint: INBOUND_HINT },
  { key: "quote", label: "Quote (Corgi)" },
  { key: "lastContact", label: "Last Rep Contact", hint: OUTBOUND_HINT },
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
  // A month filter LOCAL to this table (like the search box), so you can narrow
  // the deal list to one month without touching the whole-dashboard Month filter
  // up top (which also reshapes the KPIs, funnel and charts). "all" = every month.
  const [monthFilter, setMonthFilter] = useState<string>("all");
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

  // The months present in these deals, newest first, for the Month dropdown.
  // Built from the rows themselves so only months that actually have deals show.
  const monthOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.month).filter(Boolean)))
        .sort()
        .reverse() as string[],
    [rows],
  );

  // Filter (stage + month + won-only + search), then sort. useMemo = only recompute when inputs change.
  const processed = useMemo(() => {
    // Match by EFFECTIVE stage — the same Corgi-quote-aware definition the
    // funnel cards use — so clicking any card (including "Quoted") shows exactly
    // the deals that card counted, and never a Meeting-Booked/Closed-Won stray.
    let out =
      stageFilter === "all"
        ? rows
        : rows.filter((r) => effectiveStage(r) === stageFilter);
    if (wonOnly) out = out.filter((r) => r.stage === "Closed Won");
    if (monthFilter !== "all") out = out.filter((r) => r.month === monthFilter);

    // Search matches any field a BDR might type to find a deal: company,
    // contact, BDR, AE, stage, or notes — so "any deal they want to see" is one
    // box away, on the main screen and inside a single-BDR view alike.
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.company, r.contact, r.bdr, r.ae, effectiveStage(r), r.notes]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }

    const sorted = [...out].sort((a, b) => {
      // The "Quote" column shows the deal's Corgi value (dealValue), so sort by
      // that same figure rather than the raw HubSpot amount.
      const resolve = (p: Prospect) =>
        sortKey === "quote"
          ? dealValue(p)
          : sortKey === "lastInbound"
            ? lastPositiveContact(p)
            : p[sortKey];
      const av = resolve(a);
      const bv = resolve(b);
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, wonOnly, stageFilter, monthFilter, search, sortKey, sortDir]);

  // Pagination maths.
  const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = processed.slice(start, start + pageSize);

  // Whenever the underlying data or page size changes, go back to page 1.
  useEffect(() => setPage(1), [rows, wonOnly, stageFilter, monthFilter, search, pageSize]);

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
          <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Month
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              title="Show only deals from this month"
              className={`cursor-pointer rounded-xl border px-3 py-2 text-sm normal-case tracking-normal outline-none transition focus:ring-2 focus:ring-corgi-ginger/40 dark:bg-white/10 ${
                monthFilter === "all"
                  ? "border-black/10 bg-white/70 text-neutral-600 dark:border-white/15 dark:text-neutral-300"
                  : "border-corgi-ginger/40 bg-corgi-ginger/10 text-corgi-ginger"
              }`}
            >
              <option value="all">All Time</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {prettyMonth(m)}
                </option>
              ))}
            </select>
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any deal — company, contact, BDR, AE, stage…"
            className="w-80 rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-emerald-500/40 dark:border-white/15 dark:bg-white/10"
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
                        {FILTER_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : c.key ? (
                    <button
                      onClick={() => toggleSort(c.key!)}
                      title={c.hint}
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
                  <StageBadge stage={effectiveStage(r)} />
                </td>
                <td className="px-4 py-3">{r.bdr}</td>
                <td className="px-4 py-3">{r.ae}</td>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                  {lastPositiveContact(r) ? (
                    prettyDate(lastPositiveContact(r)!)
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {dealValue(r) > 0 ? (
                    moneyFull(dealValue(r))
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                  {r.lastContact ? (
                    prettyDate(r.lastContact)
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
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
