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
  displayStage,
  monthsFromRows,
  loadEditorName,
  saveEditorName,
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

// Which rep is "you" depends on the view. In a BDR view "you" = the BDR, so we
// use the BDR-relative signals; in an AE view "you" = the AE, so we swap to the
// AE-relative ones the backend computes alongside them. These two pickers keep
// the rest of the table view-agnostic — pass `aeView` and get the right field.
function outsideOf(r: Prospect, aeView: boolean) {
  return aeView ? r.outsideActivityAe ?? null : r.outsideActivity ?? null;
}
function repContactOf(r: Prospect, aeView: boolean): string | null {
  return (aeView ? r.lastContactAe : r.lastContact) ?? null;
}

// "Touched by others" — a deal is FLAGGED when its newest activity was logged by
// someone OTHER than the rep in focus, AFTER that rep last touched it. The
// backend hands us the "outside" activity (the newest non-rep activity, with
// who/when/action) both BDR-relative and AE-relative; we pick the one matching
// the current view and flag the row when that outside touch is newer than the
// rep's own last contact. Dates are "YYYY-MM-DD" strings, so a string compare works.
export function isFlagged(r: Prospect, aeView: boolean): boolean {
  const o = outsideOf(r, aeView);
  return Boolean(o && o.date > (repContactOf(r, aeView) ?? ""));
}

// "2026-08-15" -> "Aug 15" — the compact form used in the flag column and the
// "Needs your eyes" cards, where the year is just noise.
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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

// Plain-English tooltip for the "Outside activity" column.
const OUTSIDE_HINT =
  "The newest activity on this deal logged by someone OTHER than its own rep — who did it, and when. Blank if the rep is the most recent to touch it.";

// Stages offered in the Stage filter dropdown. The funnel no longer has a
// "Qualified" card, so the dropdown must not offer it either — otherwise you
// could filter to a stage the funnel doesn't show. "Quoted" is also dropped:
// with Django retired we no longer track it, and every former Quoted deal now
// lives in "Meeting Booked". Mirrors the funnel.
const FILTER_STAGES = STAGES.filter((s) => s !== "Qualified" && s !== "Quoted");

// Plain-English tooltip for the manual-quote column.
const MANUAL_QUOTE_HINT =
  "A quote anyone on the team can type in and edit — shared so everyone sees the same number. It's a note only: it does NOT change ARR, Closed Won, or any revenue total (those come from HubSpot). Entering one bumps a Meeting-Booked deal's badge to Quoted.";

const COLUMNS: { key: SortKey | null; label: string; hint?: string }[] = [
  { key: "company", label: "Company" },
  { key: "stage", label: "Stage" },
  { key: "bdr", label: "BDR" },
  { key: "ae", label: "AE" },
  { key: "lastInbound", label: "Last Positive Contact", hint: INBOUND_HINT },
  { key: "quote", label: "Quote (Corgi)" },
  { key: null, label: "Manual Quote", hint: MANUAL_QUOTE_HINT },
  { key: "lastContact", label: "Last Rep Contact (you)", hint: OUTBOUND_HINT },
  { key: null, label: "Outside activity", hint: OUTSIDE_HINT },
];

export default function ProspectsTable({
  rows,
  wonOnly,
  sortByWon,
  stageFilter,
  onStageFilter,
  singleRep,
  aeView,
  onSaveQuote,
  quoteStoreConfigured,
}: {
  rows: Prospect[];
  wonOnly: boolean;
  sortByWon: boolean;
  stageFilter: Stage | "all";
  onStageFilter: (s: Stage | "all") => void;
  // True when one BDR or AE is in focus. The "Needs your eyes" strip is a
  // personal to-do — it only makes sense for a single rep — so it's hidden on
  // the aggregate main page and shown only inside a BDR or AE view.
  singleRep: boolean;
  // True when the current view is an AE view (an AE is selected). Flips every
  // "you"-relative signal — Last Rep Contact, the outside-activity flag, and the
  // strip — from the deal's BDR to its AE, so an AE never sees their own activity
  // flagged as "someone else touched it".
  aeView: boolean;
  // Save (value) or clear (null) a deal's shared manual quote. Returns ok/false,
  // with notConfigured when the shared store hasn't been connected yet.
  onSaveQuote: (
    id: number,
    value: number | null,
    by: string,
  ) => Promise<{ ok: boolean; notConfigured?: boolean }>;
  // False when the shared quote store isn't connected — shows a setup hint.
  quoteStoreConfigured: boolean;
}) {
  const [search, setSearch] = useState("");
  // A month filter LOCAL to this table (like the search box), so you can narrow
  // the deal list to one month without touching the whole-dashboard Month filter
  // up top (which also reshapes the KPIs, funnel and charts). "all" = every month.
  const [monthFilter, setMonthFilter] = useState<string>("all");
  // "Touched by others" filter pill: when on, the table shows ONLY flagged deals
  // (someone other than the rep logged the newest activity). Composes with every
  // other filter below.
  const [touchedByOthers, setTouchedByOthers] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("company");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // ---- Manual quote inline editor ----
  // Which row is being edited (by deal id), plus the draft amount and the
  // free-text editor name. The name is remembered in the browser so a rep only
  // types it once. `savingId` disables the buttons mid-save; `quoteError` shows a
  // short inline message when a save can't go through.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftName, setDraftName] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    setDraftName(loadEditorName());
  }, []);

  function beginEdit(r: Prospect) {
    setQuoteError(null);
    setEditingId(r.id);
    setDraftAmount(r.manualQuote != null ? String(r.manualQuote) : "");
    setDraftName(loadEditorName());
  }

  function cancelEdit() {
    setEditingId(null);
    setQuoteError(null);
  }

  async function commitEdit(r: Prospect, clear = false) {
    const name = draftName.trim();
    if (!clear && !name) {
      setQuoteError("Add your name");
      return;
    }
    let value: number | null;
    if (clear) {
      value = null;
    } else {
      const n = Number(draftAmount.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        setQuoteError("Enter a number");
        return;
      }
      value = Math.round(n);
    }
    setSavingId(r.id);
    setQuoteError(null);
    const res = await onSaveQuote(r.id, value, name);
    setSavingId(null);
    if (res.notConfigured) {
      setQuoteError("Quote store not connected yet");
      return;
    }
    if (!res.ok) {
      setQuoteError("Couldn't save — try again");
      return;
    }
    if (!clear) saveEditorName(name);
    setEditingId(null);
  }

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
  // Uses the shared monthsFromRows helper so it matches the trend chart and the
  // top filter bar exactly — same months, and future months (e.g. next month's
  // booked meetings) are excluded from all three.
  const monthOptions = useMemo(
    () => [...monthsFromRows(rows)].reverse(),
    [rows],
  );

  // The shared filtered set — everything the table shows EXCEPT the "touched by
  // others" pill and sorting: stage, won-only, month and search. The BDR / AE /
  // month filters up top already shaped `rows`. Both the flagged list (the strip
  // and the count badges) and the final table build on THIS, so the strip always
  // reflects the same scope you're viewing — never the whole team once you've
  // narrowed down to one BDR, stage or search.
  const filtered = useMemo(() => {
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
        [r.company, r.contact, r.bdr, r.owner ?? r.ae, effectiveStage(r), r.notes]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return out;
  }, [rows, wonOnly, stageFilter, monthFilter, search]);

  // Every flagged deal in the CURRENT view (respects the BDR / stage / month /
  // search scope above), newest outside-touch first — feeds the count badges and
  // the "Needs your eyes" strip, so the strip always matches what you're viewing.
  const flagged = useMemo(
    () =>
      filtered
        .filter((r) => isFlagged(r, aeView))
        .sort((a, b) =>
          (outsideOf(b, aeView)?.date ?? "").localeCompare(
            outsideOf(a, aeView)?.date ?? "",
          ),
        ),
    [filtered, aeView],
  );

  // The table: apply the "touched by others" pill on top of the shared set, then
  // sort. useMemo = only recompute when inputs change.
  const processed = useMemo(() => {
    const out = touchedByOthers ? filtered.filter((r) => isFlagged(r, aeView)) : filtered;
    const sorted = [...out].sort((a, b) => {
      // The "Quote" column shows the deal's Corgi value (dealValue), so sort by
      // that same figure rather than the raw HubSpot amount.
      const resolve = (p: Prospect) =>
        sortKey === "quote"
          ? dealValue(p)
          : sortKey === "lastInbound"
            ? lastPositiveContact(p)
            : sortKey === "ae"
              ? p.owner ?? p.ae
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
  }, [filtered, touchedByOthers, aeView, sortKey, sortDir]);

  // Pagination maths.
  const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = processed.slice(start, start + pageSize);

  // Whenever the underlying data or page size changes, go back to page 1.
  useEffect(() => setPage(1), [rows, wonOnly, stageFilter, monthFilter, touchedByOthers, search, pageSize]);

  return (
    <section className="mb-10">
      {/* "Needs your eyes" strip — a warm banner listing every deal that someone
          other than its rep just touched. One card per flagged deal, scrolled
          horizontally, each linking straight to the deal in HubSpot. Only shown
          when there's a backlog to clear. */}
      {singleRep && flagged.length > 0 && (
        <div className="mb-4 rounded-2xl border border-corgi-ginger/30 bg-gradient-to-b from-corgi-ginger/[0.12] to-corgi-ginger/[0.04] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)] backdrop-blur-2xl backdrop-saturate-150 dark:border-corgi-ginger/25">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-corgi-ginger" />
            <h3 className="text-sm font-semibold text-corgi-ginger">
              Needs your eyes
            </h3>
            <span className="rounded-full bg-corgi-ginger/20 px-2 py-0.5 text-xs font-medium tabular-nums text-corgi-ginger">
              {flagged.length}
            </span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              someone else logged the newest activity
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {flagged.map((r) => {
              const o = outsideOf(r, aeView)!;
              return (
                <a
                  key={r.id}
                  href={hubspotUrl(r)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open this deal in HubSpot"
                  className="flex w-56 shrink-0 flex-col gap-1 rounded-xl border border-white/60 bg-white/70 p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-corgi-ginger/40 dark:border-white/10 dark:bg-white/[0.06]"
                >
                  <span className="truncate font-medium text-neutral-800 dark:text-neutral-100">
                    {r.company}
                  </span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    You last touched {shortDate(repContactOf(r, aeView))}
                  </span>
                  <span className="text-xs font-medium text-corgi-ginger">
                    {o.who ?? "Someone else"} {o.action} {shortDate(o.date)}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}
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
          {/* "Touched by others" pill — filters the table to only flagged deals.
              Shows the count so you can see the backlog at a glance; only appears
              when there's at least one flagged deal in view. */}
          {flagged.length > 0 && (
            <button
              type="button"
              onClick={() => setTouchedByOthers((v) => !v)}
              title="Show only deals where someone other than the rep logged the newest activity"
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                touchedByOthers
                  ? "border-corgi-ginger/50 bg-corgi-ginger/15 text-corgi-ginger"
                  : "border-black/10 bg-white/70 text-neutral-600 hover:border-corgi-ginger/40 hover:text-corgi-ginger dark:border-white/15 dark:bg-white/10 dark:text-neutral-300"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-corgi-ginger" />
              Touched by others
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                  touchedByOthers
                    ? "bg-corgi-ginger/25 text-corgi-ginger"
                    : "bg-black/5 text-neutral-500 dark:bg-white/10 dark:text-neutral-400"
                }`}
              >
                {flagged.length}
              </span>
            </button>
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any deal — company, contact, BDR, AE, stage…"
            className="w-80 rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-emerald-500/40 dark:border-white/15 dark:bg-white/10"
          />
        </div>
      </div>

      {!quoteStoreConfigured && (
        <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/[0.08] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Manual quotes aren&apos;t saving yet — the shared store isn&apos;t
          connected. Connect an Upstash Redis store in Vercel (Storage → Create
          Database) to turn this on for everyone.
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-white/50 bg-gradient-to-b from-white/60 to-white/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-16px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.12] dark:from-white/[0.08] dark:to-white/[0.03]">
        <table className="w-full min-w-[1000px] text-left text-sm">
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
              // A flagged row (someone else logged the newest activity) takes the
              // warm ginger treatment — ginger tint + ginger left-edge + a ginger
              // dot beside the company — overriding the health colours so the
              // alert reads at a glance.
              const flag = isFlagged(r, aeView);
              const o = outsideOf(r, aeView);
              const repContact = repContactOf(r, aeView);
              return (
              <tr
                key={r.id}
                title={flag ? "Touched by someone other than the rep — see Outside activity" : healthTitle(r)}
                className={`border-b border-black/5 transition last:border-0 dark:border-white/5 ${
                  flag
                    ? "bg-corgi-ginger/[0.07] hover:bg-corgi-ginger/[0.13]"
                    : HEALTH_BG[h]
                }`}
              >
                <td className={`border-l-[3px] px-4 py-3 font-medium ${flag ? "border-l-corgi-ginger" : HEALTH_EDGE[h]}`}>
                  <span className="inline-flex items-center gap-2">
                    {flag && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-corgi-ginger"
                        title="Touched by someone other than the rep"
                      />
                    )}
                    <a
                      href={hubspotUrl(r)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-2 transition hover:text-corgi-ginger hover:underline"
                    >
                      {r.company}
                    </a>
                  </span>
                </td>
                <td className="px-4 py-3">
                  {/* Show "Quoted" once a manual quote is entered on a still-
                      Meeting-Booked deal (displayStage). This is a visual bump
                      only — the real stage, and every money figure, is untouched. */}
                  <StageBadge stage={displayStage(r)} />
                </td>
                <td className="px-4 py-3">{r.bdr}</td>
                <td className="px-4 py-3">{r.owner ?? r.ae}</td>
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
                <td className="px-4 py-3">
                  {editingId === r.id ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-neutral-400">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoFocus
                          value={draftAmount}
                          onChange={(e) => setDraftAmount(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit(r);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          placeholder="0"
                          className="w-24 rounded-lg border border-corgi-ginger/40 bg-white/80 px-2 py-1 text-sm tabular-nums outline-none focus:ring-2 focus:ring-corgi-ginger/40 dark:bg-white/10"
                        />
                      </div>
                      <input
                        type="text"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(r);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        placeholder="Your name"
                        className="w-32 rounded-lg border border-black/10 bg-white/80 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-corgi-ginger/40 dark:border-white/15 dark:bg-white/10"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => commitEdit(r)}
                          disabled={savingId === r.id}
                          className="rounded-lg bg-corgi-ginger px-2 py-1 text-xs font-medium text-white transition hover:brightness-105 disabled:opacity-50"
                        >
                          {savingId === r.id ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-lg px-2 py-1 text-xs text-neutral-500 transition hover:text-neutral-800 dark:hover:text-neutral-200"
                        >
                          Cancel
                        </button>
                        {r.manualQuote != null && (
                          <button
                            type="button"
                            onClick={() => commitEdit(r, true)}
                            disabled={savingId === r.id}
                            className="rounded-lg px-2 py-1 text-xs text-rose-500 transition hover:text-rose-600 disabled:opacity-50"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      {quoteError && (
                        <span className="text-xs text-rose-500">{quoteError}</span>
                      )}
                    </div>
                  ) : r.manualQuote != null ? (
                    <button
                      type="button"
                      onClick={() => beginEdit(r)}
                      title="Edit manual quote"
                      className="group flex flex-col items-start gap-0.5 text-left"
                    >
                      <span className="font-medium tabular-nums text-neutral-800 underline-offset-2 group-hover:text-corgi-ginger group-hover:underline dark:text-neutral-100">
                        {moneyFull(r.manualQuote)}
                      </span>
                      {(r.manualQuoteBy || r.manualQuoteAt) && (
                        <span className="text-xs text-neutral-400">
                          {r.manualQuoteBy ? r.manualQuoteBy : "—"}
                          {r.manualQuoteAt
                            ? ` · ${shortDate(r.manualQuoteAt.slice(0, 10))}`
                            : ""}
                        </span>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => beginEdit(r)}
                      className="rounded-lg border border-dashed border-black/15 px-2 py-1 text-xs text-neutral-400 transition hover:border-corgi-ginger/50 hover:text-corgi-ginger dark:border-white/15"
                    >
                      + Add quote
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">
                  {repContact ? (
                    prettyDate(repContact)
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {/* Only show an outside touch when it happened AFTER the corp
                      rep's last contact (i.e. the row is flagged) — that's the
                      whole point of the alert. An older outside touch is stale
                      and shows as "—". */}
                  {flag ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-corgi-ginger">
                      {o!.who ?? "Someone else"}
                      <span className="font-normal text-neutral-400">·</span>
                      <span className="font-normal text-neutral-500 dark:text-neutral-400">
                        {shortDate(o!.date)}
                      </span>
                    </span>
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
