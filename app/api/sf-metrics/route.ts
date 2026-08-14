// SF Revenue metrics — ported from the standalone SF BDR dashboard
// (sf-bdr-hubspot/lib/hubspot.js) into this app so the whole BDR/AE dashboard
// lives on one side. Keeps the HubSpot token server-side and pulls only
// aggregate COUNTS (via Search `total`) so we make a handful of calls, not
// thousands. Served at GET /api/sf-metrics and consumed by /public/sf/index.html.

// Cold pulls fan out many small HubSpot Search calls; allow up to 60s so Vercel
// doesn't cut the first (uncached) build off. After that it's cached in memory.
import { getCachedProspects } from "../prospects/route";
import { TEAM_AE_NAMES } from "../prospects/team";
import type { Prospect } from "../../lib/data";

// Cold builds fan out ~180 rate-limited HubSpot Search calls (the per-rep
// activity loop) plus the shared Pipeline pull. That can run well past 60s on a
// cold serverless instance, so give it room (Vercel Pro allows up to 300s). Warm
// requests are served instantly from cache; see getMetrics (stale-while-revalidate).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TOKEN = process.env.HUBSPOT_TOKEN;
const TEAM = (process.env.SF_TEAM_NAME || "Corgi Corp").toLowerCase();
// Explicit roster: comma-separated owner emails (or ids). This is the source of
// truth for who appears on the dashboard — it overrides the team filter, so reps
// on a different HubSpot team are still included and per-refresh API cost stays
// small. Embedded default = the SF roster; override with SF_REPS env if needed.
const DEFAULT_REPS =
  "carwyn@corgi.insure,kaya@corgi.insure,andrew@corgi.insure,amos@corgi.insure," +
  "parker@trycorgi.com,jackson@trycorgi.com,broderick@trycorgi.com," +
  "richard@corgi.insure,dino@corgi.insure,garrett.peterson@corgi.insure," +
  "ethan.w@trycorgi.com,jeanette@trycorgi.com,humbert@corgi.com";
const REPS = (process.env.SF_REPS || DEFAULT_REPS)
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
// Names (or fragments) to drop from the BDR section only — AMs / pure AEs who sit
// on the roster but don't dial. Parker & Amos moved to AE-only (as of 2026-08-09):
// they're excluded here so they no longer appear on the BDR leaderboard, but they
// still show on the AE side (they own deals) and every deal they sourced is still
// pulled — this only hides their BDR row, it changes no money totals.
const BDR_EXCLUDE = (process.env.BDR_EXCLUDE || "humbert,richard,jeanette,kaya,parker,amos")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const WEEKS = +(process.env.TREND_WEEKS || 15);
const CACHE_MS = +(process.env.CACHE_MIN || 10) * 60000;
const WON = process.env.CLOSED_WON_STAGE || "closedwon";
const BOOKED = process.env.BOOKED_STAGE || "contractsent"; // demo = deal entered this stage
// Timestamp property recording when a deal entered the Booked stage.
const BOOKED_DATE_PROP = process.env.BOOKED_DATE_PROP || `hs_v2_date_entered_${BOOKED}`;
const BDR_PROP = process.env.DEAL_BDR_PROP || "bdr"; // sourcing rep
const AM_PROP = process.env.DEAL_AM_PROP || "account_manager"; // account manager
const SRC_PROP = process.env.DEAL_SOURCE_PROP || "source"; // Inbound/Referral/Outbound…
const INBOUND_SOURCES = (process.env.INBOUND_SOURCES || "inbound,referral")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const API = "https://api.hubapi.com";

type Deal = { id: string; properties: Record<string, string | null> };
type Owner = { id: string; name: string; createdAt: string };

// --- global pacing for the Search API -------------------------------------
// HubSpot caps /search at ~4 requests/second. Space every search ~260ms apart.
const SEARCH_GAP_MS = 260;
let nextSlot = 0;
function pace(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + SEARCH_GAP_MS;
  return wait ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve();
}

// --- HubSpot fetch with rate-limit (429) back-off -------------------------
async function hs(path: string, body: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    await pace();
    const r = await fetch(API + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (r.status === 429 && attempt < 5) {
      await new Promise((s) => setTimeout(s, (+(r.headers.get("Retry-After") || 1)) * 1000));
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`);
    return r.json();
  }
}
async function hsGet(path: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API + path, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: "no-store",
    });
    if (r.status === 429 && attempt < 5) {
      await new Promise((s) => setTimeout(s, (+(r.headers.get("Retry-After") || 1)) * 1000));
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
  }
}
// run tasks with limited concurrency to respect the burst limit
async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

// --- time buckets ---------------------------------------------------------
// EVERYTHING here is anchored to Pacific time (the SF team's working day), so the
// week/day boundaries line up no matter what timezone the server runs in (Vercel
// runs UTC). This also fixes the "biggest deal this week" bug: a deal's close
// date (a plain calendar day) and the week boundaries are now both measured in
// Pacific, so a deal dated on the Monday no longer slips into the previous week.
const PACIFIC_TZ = "America/Los_Angeles";
// Offset (ms) between Pacific wall-clock and UTC at a given instant (DST-aware).
function pacificOffsetMs(at: Date): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  const hour = +p.hour === 24 ? 0 : +p.hour; // en-US can render midnight as "24"
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return asUTC - at.getTime();
}
// Epoch of 00:00 Pacific on the given calendar date.
function pacificMidnight(y: number, m: number, d: number): number {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  return guess - pacificOffsetMs(new Date(guess));
}
// The calendar Y/M/D seen in Pacific for a given instant.
function pacificYMD(at: Date): { y: number; m: number; d: number } {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at).split("-").map(Number);
  return { y, m, d };
}
// Parse a date-only "YYYY-MM-DD" as 00:00 Pacific (matches how the weeks are cut).
function pacificDateEpoch(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? pacificMidnight(+m[1], +m[2], +m[3]) : NaN;
}

function weekStarts(n: number): number[] {
  const t = pacificYMD(new Date());
  // Walk back to Monday of the current Pacific week (calendar-safe UTC math).
  const base = new Date(Date.UTC(t.y, t.m - 1, t.d));
  base.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i * 7);
    out.push(pacificMidnight(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
  }
  return out; // Pacific-midnight epochs, oldest → newest
}

// count matching records for one owner in [start,end) on a timestamp property
const count = (
  obj: string,
  ownerId: string,
  tsProp: string,
  start: number,
  end: number,
  extra: unknown[] = [],
): Promise<number> =>
  hs(`/crm/v3/objects/${obj}/search`, {
    limit: 1,
    properties: [],
    filterGroups: [
      {
        filters: [
          { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
          { propertyName: tsProp, operator: "GTE", value: `${start}` },
          { propertyName: tsProp, operator: "LT", value: `${end}` },
          ...extra,
        ],
      },
    ],
  }).then((r) => r.total || 0);

// --- owners on the roster -------------------------------------------------
async function sfOwners(): Promise<{ list: Owner[]; matchedTeam: boolean }> {
  let owners: any[] = [];
  let after = "";
  do {
    const j = await hsGet(`/crm/v3/owners?limit=100${after ? `&after=${after}` : ""}`);
    owners = owners.concat(j.results || []);
    after = j.paging?.next?.after || "";
  } while (after);
  const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  const toRow = (o: any): Owner => ({
    id: o.id,
    name: titleCase([o.firstName, o.lastName].filter(Boolean).join(" ") || o.email),
    createdAt: o.createdAt,
  });

  let base: any[];
  let matchedTeam: boolean;
  if (REPS.length) {
    const wanted = new Set(REPS);
    base = owners.filter((o) => wanted.has(o.id) || wanted.has((o.email || "").toLowerCase()));
    matchedTeam = base.length > 0;
  } else {
    const sf = owners.filter((o) => (o.teams || []).some((t: any) => (t.name || "").toLowerCase().includes(TEAM)));
    base = sf.length ? sf : owners;
    matchedTeam = sf.length > 0;
  }
  return { list: base.map(toRow), matchedTeam };
}

// --- build the full metrics payload --------------------------------------
async function build() {
  if (!TOKEN) throw new Error("Missing HUBSPOT_TOKEN (see Vercel env vars)");
  // Kick off the shared Pipeline pull immediately so its (separately rate-limited)
  // network time overlaps the per-rep activity loop below instead of stacking on
  // top of it. We only await it once we actually need the won rows for money.
  const prospectsP = getCachedProspects();
  const { list, matchedTeam } = await sfOwners();
  const bdrList = list.filter((o) => !BDR_EXCLUDE.some((x) => o.name.toLowerCase().includes(x)));
  const bdrIds = bdrList.map((o) => o.id);
  const wk = weekStarts(WEEKS);
  const wkEnd = wk.map((s, i) => (i + 1 < wk.length ? wk[i + 1] : s + 7 * 864e5));
  const pnow = pacificYMD(new Date());               // "today" in Pacific
  const monthStart = pacificMidnight(pnow.y, pnow.m, 1);
  const now = Date.now();

  // Booked/demo deals only. Revenue no longer comes from a separate HubSpot pull
  // here — it comes from the SAME de-duped Pipeline rows below (see wonRows), so
  // the two dashboards can't disagree. We still pull "entered Booked" deals to
  // drive the demos-booked activity numbers on the BDR cards.
  const deals: Deal[] = [];
  {
    let after = "";
    do {
      const j = await hs(`/crm/v3/objects/deals/search`, {
        limit: 200,
        after: after || undefined,
        properties: [
          "dealname", "dealstage", "hubspot_owner_id", "amount", "closedate",
          BOOKED_DATE_PROP, BDR_PROP, AM_PROP, SRC_PROP,
        ],
        filterGroups: [
          { filters: [{ propertyName: BOOKED_DATE_PROP, operator: "GTE", value: `${wk[0]}` },
                      { propertyName: BDR_PROP, operator: "IN", values: bdrIds }] },
        ],
      });
      deals.push(...(j.results || []));
      after = j.paging?.next?.after || "";
    } while (after);
  }

  // --- demo-deal helpers (activity only) -----------------------------------
  const byId = new Map(list.map((o) => [o.id, o]));
  const byName = new Map(list.map((o) => [o.name.toLowerCase(), o]));
  const dealBdrId = (d: Deal): string | null => {
    const v = `${d.properties[BDR_PROP] ?? ""}`.trim();
    if (!v) return null;
    const id = byId.has(v) ? v : (byName.get(v.toLowerCase())?.id ?? null);
    if (id && id === d.properties.hubspot_owner_id) return null;
    return id;
  };
  const bookedAt = (d: Deal) => +new Date(d.properties[BOOKED_DATE_PROP] as string);
  const isInbound = (d: Deal) => INBOUND_SOURCES.includes(`${d.properties[SRC_PROP] ?? ""}`.trim().toLowerCase());
  const isOutbound = (d: Deal) => !isInbound(d);
  const inBucket = (t: number, s: number, e: number) => t >= s && t < e;
  const enteredBooked = (d: Deal) => !!`${d.properties[BOOKED_DATE_PROP] ?? ""}`.trim();
  const demoDeals = deals.filter(enteredBooked);

  // --- SHARED MONEY helpers. Every revenue/deal figure is built from the exact
  // de-duped, one-owner-per-company Closed-Won rows the Corp SF Pipeline uses, so
  // Pipeline and Metrics always reconcile to the penny. The rows themselves
  // (wonRows) are awaited AFTER the activity loop below, so the Pipeline pull
  // overlaps the loop instead of stacking on top of it. ---------------------
  const monthKey = `${pnow.y}-${String(pnow.m).padStart(2, "0")}`; // current Pacific month
  const same = (a?: string | null, b?: string | null) =>
    (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
  // A row is "inbound" when its source is inbound/referral (same rule as before).
  const ibRow = (r: Prospect) => INBOUND_SOURCES.includes(`${r.source ?? ""}`.trim().toLowerCase());
  const rowT = (r: Prospect) => pacificDateEpoch(`${r.closeDate ?? ""}`);
  const bucketOf = (r: Prospect): number => {
    const t = rowT(r);
    for (let i = 0; i < wk.length; i++) if (t >= wk[i] && t < wkEnd[i]) return i;
    return -1;
  };
  const zeros = () => wk.map(() => 0);
  // Weekly arr/deal series (+ inbound/outbound splits) for a set of won rows.
  const moneySeries = (listR: Prospect[]) => {
    const arr = zeros(), dealsS = zeros(), obArr = zeros(), ibArr = zeros(), obDeals = zeros(), ibDeals = zeros();
    for (const r of listR) {
      const i = bucketOf(r);
      if (i < 0) continue;
      const amt = r.quote || 0;
      arr[i] += amt; dealsS[i] += 1;
      if (ibRow(r)) { ibArr[i] += amt; ibDeals[i] += 1; }
      else { obArr[i] += amt; obDeals[i] += 1; }
    }
    return { arr, deals: dealsS, obArr, ibArr, obDeals, ibDeals };
  };
  // This-month totals (uses each row's migration-corrected month, same as Pipeline).
  const monthMoney = (listR: Prospect[]) => {
    const m = listR.filter((r) => r.month === monthKey);
    const ob = m.filter((r) => !ibRow(r)), ib = m.filter(ibRow);
    return {
      dealsMo: m.length,
      arrMo: m.reduce((a, r) => a + (r.quote || 0), 0),
      obDealsMo: ob.length, ibDealsMo: ib.length,
      obArrMo: ob.reduce((a, r) => a + (r.quote || 0), 0),
      ibArrMo: ib.reduce((a, r) => a + (r.quote || 0), 0),
    };
  };
  const monMs = wk[wk.length - 1];
  // Per-weekday (Mon–Fri) money for this week (AE cards' daily sparkline).
  const dailyMoney = (listR: Prospect[]) => {
    const out: Record<string, (number | null)[]> = { deals: [], obDeals: [], ibDeals: [], obArr: [], ibArr: [] };
    for (let d = 0; d < 5; d++) {
      const s = monMs + d * 864e5, e = s + 864e5;
      if (s > now) { for (const k in out) out[k].push(null); continue; }
      const w = listR.filter((r) => { const t = rowT(r); return t >= s && t < e; });
      out.deals.push(w.length);
      out.obDeals.push(w.filter((r) => !ibRow(r)).length);
      out.ibDeals.push(w.filter(ibRow).length);
      out.obArr.push(w.filter((r) => !ibRow(r)).reduce((a, r) => a + (r.quote || 0), 0));
      out.ibArr.push(w.filter(ibRow).reduce((a, r) => a + (r.quote || 0), 0));
    }
    return out;
  };

  // a dial = a call with any logged outcome (disposition set)
  const dialFilter = [{ propertyName: "hs_call_disposition", operator: "HAS_PROPERTY" }];
  const repsActivity = await pool(bdrList, 5, async (o) => {
    const dialsSeries = await pool(wk, 4, (s, i) => count("calls", o.id, "hs_timestamp", s, wkEnd[i], dialFilter));

    const myBooked = demoDeals.filter((d) => dealBdrId(d) === o.id);
    const inBk = (s: number, i: number) => myBooked.filter((d) => inBucket(bookedAt(d), s, wkEnd[i]));
    const demoSeries = wk.map((s, i) => inBk(s, i).length);
    const obDemos = wk.map((s, i) => inBk(s, i).filter(isOutbound).length);
    const ibDemos = wk.map((s, i) => inBk(s, i).filter(isInbound).length);

    const dayBounds = (d: number): [number, number] => [monMs + d * 864e5, monMs + (d + 1) * 864e5];
    const dailyDials = await pool([0, 1, 2, 3, 4], 3, (d) => {
      const [s, e] = dayBounds(d);
      return s > now ? Promise.resolve(null as number | null) : count("calls", o.id, "hs_timestamp", s, e, dialFilter);
    });
    const todayIdx = Math.min(4, (new Date().getDay() + 6) % 7);
    const dialsToday = dailyDials[todayIdx] ?? 0;
    const dayBooked = (d: number) => {
      const [s, e] = dayBounds(d);
      return myBooked.filter((x) => inBucket(bookedAt(x), s, e));
    };
    const dailyDemos = [0, 1, 2, 3, 4].map((d) => (dayBounds(d)[0] > now ? null : dayBooked(d).length));
    const dailyObDemos = [0, 1, 2, 3, 4].map((d) => (dayBounds(d)[0] > now ? null : dayBooked(d).filter(isOutbound).length));
    const dailyIbDemos = [0, 1, 2, 3, 4].map((d) => (dayBounds(d)[0] > now ? null : dayBooked(d).filter(isInbound).length));

    const bookedWeek = demoSeries[demoSeries.length - 1];
    const mtgBooked = await count("meetings", o.id, "hs_meeting_start_time", wk[wk.length - 1], wkEnd[wkEnd.length - 1]);
    const mtgHeld = await count("meetings", o.id, "hs_meeting_start_time", wk[wk.length - 1], wkEnd[wkEnd.length - 1],
      [{ propertyName: "hs_meeting_outcome", operator: "EQ", value: "COMPLETED" }]);

    const monthIdx = wk.map((s, i) => (wkEnd[i] > monthStart ? i : -1)).filter((i) => i >= 0);
    const sum = (arr: number[], idx: number[]) => idx.reduce((a, i) => a + arr[i], 0);

    return {
      name: o.name,
      stage: Date.now() - +new Date(o.createdAt) < 30 * 864e5 ? "ramp" : "steady",
      dials: dialsToday,
      appts: bookedWeek ? Math.round(bookedWeek / 5) : 0,
      connects: null,
      dialsWeek: dialsSeries[dialsSeries.length - 1],
      dialsMonth: sum(dialsSeries, monthIdx),
      demosWk: bookedWeek,
      showRate: mtgBooked ? mtgHeld / mtgBooked : 0,
      series: { dials: dialsSeries, demos: demoSeries, obDemos, ibDemos },
      daily: { dials: dailyDials, demos: dailyDemos, obDemos: dailyObDemos, ibDemos: dailyIbDemos },
      startWeek: dialsSeries.findIndex((v) => v > 0),
    };
  });

  // --- SHARED MONEY: now that the (parallel) Pipeline pull is done, fold each
  // rep's revenue in. wonRows = the de-duped Closed-Won rows the Pipeline uses. --
  const prospects = await prospectsP;
  const wonRows = prospects.filter((r) => r.stage === "Closed Won");
  const reps = repsActivity.map((rep) => {
    // A BDR's money = their sourced Closed-Won rows, EXCLUDING any they also own
    // as the AE (those count once, on the AE side) — the Pipeline rule.
    const mineWon = wonRows.filter((r) => same(r.bdr, rep.name) && !same(r.ae, rep.name));
    const ms = moneySeries(mineWon);
    const mm = monthMoney(mineWon);
    return {
      ...rep,
      dealsMo: mm.dealsMo,
      arrMo: mm.arrMo,
      obDealsMo: mm.obDealsMo,
      ibDealsMo: mm.ibDealsMo,
      obArrMo: mm.obArrMo,
      ibArrMo: mm.ibArrMo,
      series: { ...rep.series, arr: ms.arr, deals: ms.deals, obDeals: ms.obDeals, ibDeals: ms.ibDeals, obArr: ms.obArr, ibArr: ms.ibArr },
    };
  });

  // BIGGEST DEAL CLOSED THIS WEEK (from the shared rows)
  const thisWeekStart = wk[wk.length - 1];
  let bigDeal: any = null;
  for (const r of wonRows) {
    const t = rowT(r);
    if (isNaN(t) || t < thisWeekStart || t > now) continue;
    const amount = r.quote || 0;
    if (!bigDeal || amount > bigDeal.amount) {
      bigDeal = {
        amount,
        company: (r.company || "—").split(" - ")[0].trim(),
        ae: r.ae && r.ae !== "Unassigned" ? r.ae : "—",
        bdr: r.bdr || "—",
        am: "—",
      };
    }
  }

  // --- AEs: Closed-Won rows per owning AE (team AEs only), from shared rows.
  // An AE's rows = deals they OWN (closed) OR deals they SELF-SOURCED (were the
  // sourcing BDR on) — self-sourced deals count as that AE's ARR even when the
  // owner field is blank, since Parker/Amos became AEs and their sourced deals
  // are now AE revenue, not BDR revenue. (BDR reps still exclude them entirely.)
  const aeMine = (name: string) =>
    wonRows.filter((r) => same(r.ae, name) || same(r.bdr, name));
  const aeNames = TEAM_AE_NAMES.filter((n) => aeMine(n).length > 0);
  const aes = aeNames.map((name) => {
    const mine = aeMine(name);
    const ms = moneySeries(mine);
    const mm = monthMoney(mine);
    return {
      name,
      start: ms.deals.findIndex((v) => v > 0),
      dealsMo: mm.dealsMo, obDealsMo: mm.obDealsMo, ibDealsMo: mm.ibDealsMo,
      obArrMo: mm.obArrMo, ibArrMo: mm.ibArrMo,
      series: { deals: ms.deals, obDeals: ms.obDeals, ibDeals: ms.ibDeals, obArr: ms.obArr, ibArr: ms.ibArr },
      daily: dailyMoney(mine),
    };
  });

  // TEAM — every Closed-Won row (each deal once), bucketed by week.
  const team: { deals: number[]; arr: number[] } = { deals: [], arr: [] };
  wk.forEach((s, i) => {
    const w = wonRows.filter((r) => { const t = rowT(r); return t >= s && t < wkEnd[i]; });
    team.deals.push(w.length);
    team.arr.push(w.reduce((a, r) => a + (r.quote || 0), 0));
  });

  // TEAM MONTH — the ONE uniform "this month" number shown on BOTH the landing
  // ring and the dark Sourced-ARR bar. It is EVERY Closed-Won deal this month,
  // counted once, split outbound/inbound by source — the exact same rows the
  // Pipeline "Won Value by Month" bar counts, so all three cards always reconcile
  // to the penny. Built straight from wonRows, so it is completely independent of
  // the BDR leaderboard (BDR_EXCLUDE): moving Parker/Amos from BDR to AE, or hiding
  // anyone from a leaderboard, can never move this total.
  const teamMonth = monthMoney(wonRows);

  return {
    updatedAt: new Date().toISOString(),
    weeks: WEEKS,
    rangeStart: new Date(wk[0]).toISOString().slice(0, 10),
    matchedTeam,
    connectsAvailable: false,
    bigDeal,
    reps,
    aes,
    team,
    teamMonth,
  };
}

// --- cache ----------------------------------------------------------------
let cache: { at: number; data: any } = { at: 0, data: null };
let inflight: Promise<any> | null = null;
function rebuild(): Promise<any> {
  if (inflight) return inflight;
  inflight = build()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
async function getMetrics() {
  const fresh = cache.data && Date.now() - cache.at < CACHE_MS;
  if (fresh) return cache.data;
  // Stale-while-revalidate: if we already have data, serve it instantly and
  // refresh in the background so a user never waits on the slow cold build. Only
  // the very first load (empty cache) blocks on build().
  if (cache.data) {
    rebuild().catch(() => cache.data); // swallow bg errors; keep serving stale
    return cache.data;
  }
  return rebuild();
}

// Edge/CDN caching for the computed payload. This serves the EXACT same numbers
// build() produced — it only changes WHERE the finished JSON is served from, so
// no figure can change. Because the per-instance memory cache above is lost on a
// serverless cold start, without this every cold visitor re-paid the ~40s HubSpot
// build. With it, Vercel's shared CDN answers instantly for `s-maxage` seconds and
// then serves the cached copy while refreshing in the background (SWR), so a user
// is never blocked on the slow pull. Windows mirror the in-app cache (5 min).
const CDN_CACHE = "public, s-maxage=300, stale-while-revalidate=900";

export async function GET() {
  try {
    return Response.json(await getMetrics(), {
      headers: { "Cache-Control": CDN_CACHE, "CDN-Cache-Control": CDN_CACHE },
    });
  } catch (e) {
    // Errors are returned WITHOUT cache headers, so a transient failure is never
    // cached at the edge.
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
