"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getProspects,
  getRoster,
  getManualQuotes,
  applyManualQuotes,
  saveManualQuote,
  loadCachedProspects,
  filterProspects,
  computeFunnel,
  computeDealValues,
  computeQuota,
  computeKpis,
  computeMonthlyTrend,
  computeInsights,
  monthsFromRows,
  atRiskDeals,
  DEFAULT_FILTERS,
  type Filters,
  type Stage,
  type Prospect,
  type ManualQuoteMap,
} from "../lib/data";
import { Skeleton } from "../lib/ui";
import Header from "./Header";
import FilterBar from "./FilterBar";
import ManageBdrs from "./ManageBdrs";
import { KpiStrip, InsightsPanel, Funnel, DealValue, QuotaCard, AtRiskDeals } from "./Sections";
import { WonTrend } from "./Charts";
import ProspectsTable from "./ProspectsTable";

export default function Dashboard() {
  // ---- Shared state (the "controls" that change what's shown) ----
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [team, setTeam] = useState<"bdr" | "ae">("bdr");
  const [sortByWon, setSortByWon] = useState(false);
  const [wonOnly, setWonOnly] = useState(false);
  const [stageFilter, setStageFilter] = useState<Stage | "all">("all");
  const [loading, setLoading] = useState(true);

  // ---- Load the real deals from our server route (falls back to sample
  // data inside getProspects if HubSpot is unavailable). ----
  const [allRows, setAllRows] = useState<Prospect[]>([]);
  useEffect(() => {
    let alive = true;
    // Instant paint: if we saved a payload on a previous visit, show it right
    // away so the dashboard isn't blank while the slow first live pull runs.
    const cached = loadCachedProspects();
    if (cached) {
      setAllRows(cached);
      setLoading(false);
    }
    // Pull the latest deals now, then quietly re-pull every 3 minutes so the
    // numbers stay fresh without anyone reloading the page. The re-pulls run in
    // the background (no loading skeleton) so the dashboard never flickers.
    const load = () =>
      getProspects().then((data) => {
        if (!alive) return;
        setAllRows(data);
        setLoading(false);
      });
    load();
    const id = setInterval(load, 3 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // ---- Manual quotes: the shared, DISPLAY-ONLY overlay (see quoteStore.ts). ----
  // Keyed by HubSpot deal id. We keep it as its own state and only ever attach it
  // onto rows as extra fields, so it can never reach any money computation.
  const [manualMap, setManualMap] = useState<ManualQuoteMap>({});
  // False until we know the shared store is connected; drives the setup hint.
  const [quoteStoreConfigured, setQuoteStoreConfigured] = useState(true);
  useEffect(() => {
    let alive = true;
    const loadQuotes = () =>
      getManualQuotes().then(({ configured, quotes }) => {
        if (!alive) return;
        setQuoteStoreConfigured(configured);
        setManualMap(quotes);
      });
    loadQuotes();
    // Re-pull periodically so one teammate's edits show up for everyone.
    const id = setInterval(loadQuotes, 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Save (or clear) a manual quote, then reflect it locally right away so the
  // editor sees their change instantly without waiting for the next poll.
  async function handleSaveQuote(
    id: number,
    value: number | null,
    by: string,
  ): Promise<{ ok: boolean; notConfigured?: boolean }> {
    const res = await saveManualQuote(id, value, by);
    if (res.notConfigured) {
      setQuoteStoreConfigured(false);
      return { ok: false, notConfigured: true };
    }
    if (!res.ok) return { ok: false };
    setManualMap((m) => {
      const next = { ...m };
      if (res.cleared) delete next[String(id)];
      else if (res.entry) next[String(id)] = res.entry;
      return next;
    });
    return { ok: true };
  }

  // The official team roster from the server (app/api/prospects/team.ts). We show
  // everyone on it — even a rep with 0 deals so far, like someone just added — so
  // new teammates appear immediately instead of only after their first deal.
  const [rosterBdrs, setRosterBdrs] = useState<string[]>([]);
  const [rosterAes, setRosterAes] = useState<string[]>([]);
  // Former BDRs: their deals still count in the totals, but they're hidden from
  // the BDR filter so they don't show as an active, selectable rep.
  const [hiddenBdrs, setHiddenBdrs] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    getRoster().then((r) => {
      if (!alive || !r) return;
      setRosterBdrs(r.bdrs);
      setRosterAes(r.aes);
      setHiddenBdrs(r.hiddenBdrs);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The BDR list = everyone on the official roster PLUS anyone who has deals but
  // somehow isn't on the roster (belt-and-suspenders), so the dashboard always
  // shows all teammates and never silently drops someone who has real deals.
  const dataBdrs = useMemo(() => {
    const hidden = new Set(hiddenBdrs.map((n) => n.toLowerCase()));
    return Array.from(
      new Set(
        [...rosterBdrs, ...allRows.map((r) => r.bdr)].filter(
          (b) => b && b !== "Unassigned" && !hidden.has(b.toLowerCase()),
        ),
      ),
    ).sort();
  }, [allRows, rosterBdrs, hiddenBdrs]);

  // The month dropdown is built from the months that actually have deals, so
  // new months (July, August, …) appear on their own — nothing is hardcoded.
  // Uses the shared monthsFromRows helper (matches the chart + table filter, and
  // drops future months like next month's booked meetings).
  const dataMonths = useMemo(() => monthsFromRows(allRows), [allRows]);

  // Same idea for AEs (the deal owners), used by the AE breakdown tab: roster
  // first, plus any AE who has deals but isn't on the roster.
  const dataAes = useMemo(
    () =>
      Array.from(
        new Set(
          [...rosterAes, ...allRows.map((r) => r.ae)].filter(
            (a) => a && a !== "Unassigned",
          ),
        ),
      ).sort(),
    [allRows, rosterAes],
  );

  // "Manage BDRs" can tweak this in-session; it re-syncs when data reloads.
  const [bdrs, setBdrs] = useState<string[]>([]);
  useEffect(() => {
    setBdrs(dataBdrs);
  }, [dataBdrs]);

  function updateBdrs(next: string[]) {
    setBdrs(next);
    // If the currently-filtered BDR was removed, drop back to "all".
    if (filters.bdr !== "all" && !next.includes(filters.bdr)) {
      setFilters({ ...filters, bdr: "all" });
    }
  }

  // Pick a rep from the top filter bar → flip the breakdown to that team so the
  // leaderboard, cards and focused view all follow (AE dropdown → AE view, BDR
  // dropdown → BDR view). BDR and AE selection are mutually exclusive.
  useEffect(() => {
    if (filters.ae !== "all") setTeam("ae");
    else if (filters.bdr !== "all") setTeam("bdr");
  }, [filters.bdr, filters.ae]);

  // ---- Derived data (recalculated only when inputs change) ----
  // Attach the manual-quote overlay (display-only fields) before anything else.
  // This ONLY adds manualQuote/By/At; it never changes `quote` or `stage`, so all
  // the money math below is provably unaffected by manual quotes.
  const overlaidRows = useMemo(
    () => applyManualQuotes(allRows, manualMap),
    [allRows, manualMap],
  );
  const rows = useMemo(() => filterProspects(overlaidRows, filters), [overlaidRows, filters]);
  const funnel = useMemo(() => computeFunnel(rows), [rows]);
  const values = useMemo(() => computeDealValues(rows), [rows]);
  const quota = useMemo(
    () => computeQuota(rows, filters, team, dataAes.length),
    [rows, filters, team, dataAes.length],
  );
  const kpis = useMemo(() => computeKpis(rows), [rows]);
  const trend = useMemo(() => computeMonthlyTrend(rows), [rows]);
  const insights = useMemo(() => computeInsights(rows), [rows]);
  const atRisk = useMemo(() => atRiskDeals(rows), [rows]);

  // Click a funnel card → filter deals by that stage; same one again → clear.
  function selectStage(f: Stage | "all") {
    setStageFilter((prev) => (f === "all" || prev === f ? "all" : f));
  }

  function clearAll() {
    setFilters(DEFAULT_FILTERS);
    setStageFilter("all");
    setWonOnly(false);
    setSortByWon(false);
  }

  const anyFilter =
    filters.month !== "all" ||
    filters.bdr !== "all" ||
    filters.ae !== "all" ||
    stageFilter !== "all" ||
    wonOnly;

  // One rep in focus (the BDR filter on the BDR tab, the AE filter on the AE
  // tab) → hide the cross-rep comparison sections and switch to that rep's
  // focused view.
  const singleRep = (team === "bdr" ? filters.bdr : filters.ae) !== "all";
  const teamLabel = team === "bdr" ? "BDR" : "AE";

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Header />
      <div className="mb-3 flex justify-end">
        <ManageBdrs bdrs={bdrs} onChange={updateBdrs} />
      </div>
      <FilterBar filters={filters} setFilters={setFilters} bdrs={bdrs} aes={dataAes} months={dataMonths} />

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <KpiStrip kpis={kpis} />
          <InsightsPanel insights={insights} />
          <Funnel funnel={funnel} activeStage={stageFilter} onSelect={selectStage} />
          <DealValue
            values={values}
            sortByWon={sortByWon}
            wonOnly={wonOnly}
            onToggleSort={() => setSortByWon((v) => !v)}
            onToggleWonOnly={() => setWonOnly((v) => !v)}
          />
          <QuotaCard quota={quota} perRep={singleRep} teamLabel={teamLabel} />

          {/* At-risk deals only make sense for a single rep in focus; the
              Won-value trend always spans the full width. */}
          {singleRep && <AtRiskDeals deals={atRisk} />}
          <section className="mb-10">
            <WonTrend data={trend} />
          </section>

          {anyFilter && <ActiveFilters {...{ filters, stageFilter, wonOnly, clearAll }} />}

          <ProspectsTable
            rows={rows}
            wonOnly={wonOnly}
            sortByWon={sortByWon}
            stageFilter={stageFilter}
            onStageFilter={selectStage}
            singleRep={singleRep}
            aeView={filters.ae !== "all"}
            onSaveQuote={handleSaveQuote}
            quoteStoreConfigured={quoteStoreConfigured}
          />
        </>
      )}
    </main>
  );
}

// Small strip showing which section-driven filters are active, with a clear button.
function ActiveFilters({
  filters,
  stageFilter,
  wonOnly,
  clearAll,
}: {
  filters: Filters;
  stageFilter: Stage | "all";
  wonOnly: boolean;
  clearAll: () => void;
}) {
  const chips: string[] = [];
  if (filters.month !== "all") chips.push(filters.month);
  if (filters.bdr !== "all") chips.push(`BDR: ${filters.bdr}`);
  if (filters.ae !== "all") chips.push(`AE: ${filters.ae}`);
  if (stageFilter !== "all") {
    chips.push(`Stage: ${stageFilter}`);
  }
  if (wonOnly) chips.push("Won deals only");

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-neutral-500 dark:text-neutral-400">Filtering deals by:</span>
      {chips.map((c) => (
        <span
          key={c}
          className="rounded-full bg-corgi-ginger/15 px-3 py-1 text-corgi-ginger"
        >
          {c}
        </span>
      ))}
      <button
        onClick={clearAll}
        className="ml-1 rounded-full px-2 py-1 text-neutral-500 underline-offset-2 transition hover:text-neutral-800 hover:underline dark:hover:text-neutral-200"
      >
        Clear all ✕
      </button>
    </div>
  );
}

// Grey placeholder shown for the brief "loading" moment.
function LoadingState() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
