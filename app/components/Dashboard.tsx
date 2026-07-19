"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getProspects,
  filterProspects,
  computeFunnel,
  computeDealValues,
  computeQuota,
  computeRepStats,
  computeKpis,
  computeMonthlyTrend,
  computeInsights,
  DEFAULT_FILTERS,
  type Filters,
  type Stage,
  type Prospect,
} from "../lib/data";
import { Skeleton } from "../lib/ui";
import Header from "./Header";
import FilterBar from "./FilterBar";
import ManageBdrs from "./ManageBdrs";
import { KpiStrip, InsightsPanel, Funnel, DealValue, QuotaAndRevenue, RepCards } from "./Sections";
import { WonTrend, RepLeaderboard } from "./Charts";
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

  // The BDR roster is derived straight from the deals (whoever actually has
  // deals in HubSpot), so it's always in sync with the data — no hardcoded list.
  const dataBdrs = useMemo(
    () =>
      Array.from(
        new Set(allRows.map((r) => r.bdr).filter((b) => b && b !== "Unassigned")),
      ).sort(),
    [allRows],
  );

  // The month dropdown is built from the months that actually have deals, so
  // new months (July, August, …) appear on their own — nothing is hardcoded.
  const dataMonths = useMemo(
    () =>
      Array.from(
        new Set(allRows.map((r) => r.month).filter(Boolean)),
      ).sort() as string[],
    [allRows],
  );

  // Same idea for AEs (the deal owners), used by the AE breakdown tab.
  const dataAes = useMemo(
    () =>
      Array.from(
        new Set(allRows.map((r) => r.ae).filter((a) => a && a !== "Unassigned")),
      ).sort(),
    [allRows],
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

  // ---- Derived data (recalculated only when inputs change) ----
  const rows = useMemo(() => filterProspects(allRows, filters), [allRows, filters]);
  const funnel = useMemo(() => computeFunnel(rows), [rows]);
  const values = useMemo(() => computeDealValues(rows), [rows]);
  const quota = useMemo(() => computeQuota(rows, filters), [rows, filters]);
  const repStats = useMemo(
    () =>
      computeRepStats(
        rows,
        team,
        team === "bdr" ? bdrs : dataAes,
        filters.month !== "all",
      ),
    [rows, team, bdrs, dataAes, filters.month],
  );
  const kpis = useMemo(() => computeKpis(rows), [rows]);
  const trend = useMemo(() => computeMonthlyTrend(rows), [rows]);
  const insights = useMemo(() => computeInsights(rows), [rows]);

  // Which rep (if any) is selected for the current team tab.
  const selectedRep = team === "bdr" ? filters.bdr : filters.ae;

  // Click a rep card → filter to them; click the same one again → clear.
  function selectRep(name: string) {
    const key = team === "bdr" ? "bdr" : "ae";
    setFilters({ ...filters, [key]: filters[key] === name ? "all" : name });
  }

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

  // One BDR in focus → hide the cross-rep comparison sections.
  const singleBdr = filters.bdr !== "all";

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Header />
      <div className="mb-3 flex justify-end">
        <ManageBdrs bdrs={bdrs} onChange={updateBdrs} />
      </div>
      <FilterBar filters={filters} setFilters={setFilters} bdrs={bdrs} months={dataMonths} />

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
          <QuotaAndRevenue
            quota={quota}
            confirmed={values.confirmed}
            perBdr={filters.bdr !== "all"}
          />

          {/* The leaderboard and per-rep breakdown are for comparing reps to
              each other, so they only make sense when viewing the whole team.
              Once a single BDR is in focus, hide them and let the Won-value
              trend (their own numbers) take the full width. */}
          {singleBdr ? (
            <section className="mb-10">
              <WonTrend data={trend} />
            </section>
          ) : (
            <>
              {/* The leaderboard is a BDR-quota comparison, so it only shows on
                  the BDR tab. On the AE tab it's hidden and the Won-value trend
                  takes the full width. */}
              {team === "bdr" ? (
                <section className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <WonTrend data={trend} />
                  <RepLeaderboard stats={repStats} teamLabel="BDR" />
                </section>
              ) : (
                <section className="mb-10">
                  <WonTrend data={trend} />
                </section>
              )}

              <RepCards
                team={team}
                setTeam={setTeam}
                stats={repStats}
                selected={selectedRep}
                onSelect={selectRep}
                showQuota={team === "bdr"}
              />
            </>
          )}

          {anyFilter && <ActiveFilters {...{ filters, stageFilter, wonOnly, clearAll }} />}

          <ProspectsTable
            rows={rows}
            wonOnly={wonOnly}
            sortByWon={sortByWon}
            stageFilter={stageFilter}
            onStageFilter={selectStage}
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
