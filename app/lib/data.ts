// ============================================================================
// FAKE DATA + THE "BRAIN"  (app/lib/data.ts)
// ----------------------------------------------------------------------------
// This is the ONE file you replace when you're ready to plug in real APIs
// (HubSpot, Django CRM, etc.). Everything the dashboard shows is calculated
// from the `PROSPECTS` array below using the helper functions at the bottom.
//
// To go live later: keep the types + helper functions, and change
// `getProspects()` so it fetches from your API instead of returning fake rows.
// ============================================================================

// ---- The stages a deal moves through -------------------------------------
// This dashboard only tracks real deals a BDR has in HubSpot — a "prospect"
// (cold outreach that isn't a deal yet) is deliberately not a stage here.
export const STAGES = [
  "Meeting Booked",
  "Qualified",
  "Quoted",
  "Closed Won",
  "Ghosting",
  "Closed Lost",
] as const;

export type Stage = (typeof STAGES)[number];

// How "far along" each stage is. Higher = further down the funnel.
// Ghosting and Closed Lost are -1 because they're dropouts, not steps forward.
export const STAGE_RANK: Record<Stage, number> = {
  "Meeting Booked": 1,
  Qualified: 2,
  Quoted: 3,
  "Closed Won": 4,
  Ghosting: -1,
  "Closed Lost": -1,
};

// ---- The team -------------------------------------------------------------
// The starting BDR roster. This is just the SEED — the live roster is stored in
// the browser (localStorage) so you can add/remove BDRs from the dashboard
// without touching code. See loadBdrRoster / saveBdrRoster below.
export const DEFAULT_BDRS = [
  "Jed", "Oz", "Ben", "Daryl", "Gabriel", "Carwyn",
  "Luke", "Dino", "Andrew", "Parker", "Amos",
] as const;

// Where the editable roster is remembered, and the password that unlocks the
// "Manage BDRs" panel. This password is a CONVENIENCE LOCK only — anyone who can
// view the page source could bypass it, so don't use a real/sensitive password.
export const BDR_STORAGE_KEY = "corgi-bdr-roster";
export const MANAGE_BDR_PASSWORD = "corgi123"; // ← change me to whatever you like

// Read the live roster from the browser. Falls back to the seed list on the
// server (no browser storage) or if nothing has been saved yet.
export function loadBdrRoster(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_BDRS];
  try {
    const raw = window.localStorage.getItem(BDR_STORAGE_KEY);
    if (!raw) return [...DEFAULT_BDRS];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {
    // ignore malformed storage and fall back to the seed
  }
  return [...DEFAULT_BDRS];
}

// Save the live roster back to the browser so it survives a page refresh.
export function saveBdrRoster(list: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BDR_STORAGE_KEY, JSON.stringify(list));
}

export const AES = [
  "Gavin Winchell", "Garrett Martell", "Tor Gordon", "Alex Frankel",
  "Matt Elmer", "Andrew Gordillo", "Sam Noyce",
] as const;

export const MONTHS = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
] as const;

// ---- Targets (quota) ------------------------------------------------------
// Change these numbers to match your real targets.
export const QUOTA = {
  currency: "$",
  teamMonthly: 300_000,
  teamAnnual: 3_600_000,
  bdrMonthly: 50_000,
  bdrAnnual: 600_000,
};

// "Today" for the sample data. With real data you'd use the actual current
// date; here it's fixed so the stale-deal alert has a believable mix.
export const TODAY = "2026-06-18";

// A deal is "at risk" after this many days with no positive contact,
// and shows a warning once it reaches WARN_DAYS (the "about to slip" zone).
export const STALE_DAYS = 4;
export const WARN_DAYS = 3;

// Where a deal lives in HubSpot. This is the exact record-page format for our
// portal (244821378) on the na2 data centre, so clicking a company name opens
// that deal's real HubSpot record. `0-3` is HubSpot's internal code for "deal".
export const HUBSPOT_BASE =
  "https://app-na2.hubspot.com/contacts/244821378/record/0-3/";

// ---- The shape of a single deal/prospect ---------------------------------
export type Prospect = {
  id: number;
  company: string;
  stage: Stage;
  bdr: string;
  ae: string;
  contact: string;
  meetingDate: string | null;  // ISO date, or null if no meeting yet
  quote: number;               // deal value
  notes: string;
  month: string;               // e.g. "2026-03"
  confirmed: boolean;          // Corgi quote was purchased (real confirmed revenue)
  lastContact: string | null;  // ISO date of the last positive contact (null = never)
  // ---- Real Corgi/Django quote data (attached by the server route) ---------
  // Left undefined on the sample rows below; set for every live deal.
  hasCorgiQuote?: boolean;     // a matching quote exists in Corgi/Django
  corgiStatus?: string | null; // e.g. "purchased", "quoted"
  corgiPremium?: number;       // annual premium (USD) from the matched quote
};

// Stages that are a FINAL outcome. Once a deal is won or dead, a Corgi quote
// existing on it doesn't drag it back into the "Quoted" bucket.
const TERMINAL_STAGES: Stage[] = ["Closed Won", "Ghosting", "Closed Lost"];

// The ONE source of truth for which stage a deal counts as. A live deal that
// Corgi/Django actually has a quote for is shown and counted as "Quoted", no
// matter what loose stage HubSpot left it in (e.g. still "Meeting Booked").
// Because the funnel count, the click-through list, and the stage badge all
// call this same function, the "Quoted" card and the deals it opens always
// match — and clicking it can never surface a Meeting-Booked or Closed-Won row.
// Sample rows have no Corgi data (hasCorgiQuote is undefined), so they simply
// keep their own HubSpot stage and the demo still works.
export function effectiveStage(p: Prospect): Stage {
  if (TERMINAL_STAGES.includes(p.stage)) return p.stage;
  if (p.hasCorgiQuote) return "Quoted";
  return p.stage;
}

// A deal counts as "Quoted" only when its effective stage is Quoted (i.e. it
// has a real Corgi/Django quote and hasn't already been won or lost).
export function isQuoted(p: Prospect): boolean {
  return effectiveStage(p) === "Quoted";
}

// ---------------------------------------------------------------------------
// THE FAKE ROWS. Each line is one deal. Edit freely — the whole dashboard
// updates automatically. Replace this array with real API data later.
// ---------------------------------------------------------------------------
const PROSPECTS: Prospect[] = [
  { id: 1,  company: "Northwind Traders",   stage: "Closed Won",    bdr: "Jed",     ae: "Gavin Winchell",  contact: "Priya Shah",     meetingDate: "2026-01-08", quote: 48000, notes: "Signed annual contract", month: "2026-01", confirmed: true,  lastContact: "2026-01-10" },
  { id: 2,  company: "Blue Yonder Airlines", stage: "Quoted",       bdr: "Oz",      ae: "Garrett Martell", contact: "Tom Reyes",      meetingDate: "2026-01-14", quote: 32000, notes: "Awaiting procurement sign-off", month: "2026-01", confirmed: false, lastContact: "2026-06-16" },
  { id: 3,  company: "Contoso Ltd",          stage: "Qualified",    bdr: "Ben",     ae: "Tor Gordon",      contact: "Maria Lind",     meetingDate: "2026-01-19", quote: 21000, notes: "Budget confirmed for Q2", month: "2026-01", confirmed: false, lastContact: "2026-06-10" },
  { id: 4,  company: "Fabrikam Inc",         stage: "Ghosting",     bdr: "Daryl",   ae: "Alex Frankel",    contact: "Nate Okafor",    meetingDate: "2026-01-22", quote: 15000, notes: "No reply in 3 weeks", month: "2026-01", confirmed: false, lastContact: "2026-01-22" },
  { id: 5,  company: "Adventure Works",      stage: "Closed Won",   bdr: "Gabriel", ae: "Matt Elmer",      contact: "Sofia Bruno",    meetingDate: "2026-01-27", quote: 61000, notes: "Expansion upsell included", month: "2026-01", confirmed: true,  lastContact: "2026-01-27" },
  { id: 6,  company: "Tailspin Toys",        stage: "Meeting Booked", bdr: "Carwyn", ae: "Andrew Gordillo", contact: "Leo Vance",     meetingDate: "2026-02-03", quote: 18000, notes: "Discovery call scheduled", month: "2026-02", confirmed: false, lastContact: "2026-06-17" },
  { id: 7,  company: "Wingtip Ltd",          stage: "Qualified",    bdr: "Luke",    ae: "Sam Noyce",       contact: "Hana Ito",       meetingDate: "2026-02-05", quote: 27000, notes: "Technical fit confirmed", month: "2026-02", confirmed: false, lastContact: "2026-06-09" },
  { id: 8,  company: "Proseware Group",      stage: "Quoted",       bdr: "Dino",    ae: "Gavin Winchell",  contact: "Owen Blake",     meetingDate: "2026-02-09", quote: 44000, notes: "Quote sent, chasing", month: "2026-02", confirmed: false, lastContact: "2026-06-15" },
  { id: 9,  company: "Litware Holdings",     stage: "Closed Won",   bdr: "Andrew",  ae: "Garrett Martell", contact: "Ines Marsh",     meetingDate: "2026-02-12", quote: 53000, notes: "Multi-year deal", month: "2026-02", confirmed: true,  lastContact: "2026-02-12" },
  { id: 11, company: "Graphic Design Inst",  stage: "Ghosting",     bdr: "Parker",  ae: "Alex Frankel",    contact: "Elena Frost",    meetingDate: "2026-02-18", quote: 9000,  notes: "Went dark after demo", month: "2026-02", confirmed: false, lastContact: "2026-02-18" },
  { id: 12, company: "Coho Vineyard",        stage: "Qualified",    bdr: "Amos",    ae: "Matt Elmer",      contact: "Diego Sol",      meetingDate: "2026-02-21", quote: 30000, notes: "Champion identified", month: "2026-02", confirmed: false, lastContact: "2026-06-16" },
  { id: 13, company: "Alpine Ski House",     stage: "Closed Won",   bdr: "Jed",     ae: "Andrew Gordillo", contact: "Mila Frost",     meetingDate: "2026-03-02", quote: 72000, notes: "Flagship logo win", month: "2026-03", confirmed: true,  lastContact: "2026-03-02" },
  { id: 14, company: "Margie's Travel",      stage: "Quoted",       bdr: "Oz",      ae: "Sam Noyce",       contact: "Ken Amari",      meetingDate: "2026-03-06", quote: 26000, notes: "Negotiating terms", month: "2026-03", confirmed: false, lastContact: "2026-06-11" },
  { id: 15, company: "Humongous Insurance",  stage: "Meeting Booked", bdr: "Ben",   ae: "Gavin Winchell",  contact: "Lara Voss",      meetingDate: "2026-03-09", quote: 88000, notes: "Enterprise, long cycle", month: "2026-03", confirmed: false, lastContact: "2026-06-17" },
  { id: 16, company: "Trey Research",        stage: "Qualified",    bdr: "Daryl",   ae: "Garrett Martell", contact: "Sam Okine",      meetingDate: "2026-03-11", quote: 19000, notes: "Pilot proposed", month: "2026-03", confirmed: false, lastContact: "2026-06-13" },
  { id: 17, company: "Lucerne Publishing",   stage: "Closed Won",   bdr: "Gabriel", ae: "Tor Gordon",      contact: "Aya Kato",       meetingDate: "2026-03-15", quote: 41000, notes: "Renewed + upsell", month: "2026-03", confirmed: true,  lastContact: "2026-03-15" },
  { id: 19, company: "Woodgrove Bank",       stage: "Quoted",       bdr: "Luke",    ae: "Matt Elmer",      contact: "Nora Beck",      meetingDate: "2026-03-20", quote: 67000, notes: "Legal reviewing MSA", month: "2026-03", confirmed: false, lastContact: "2026-06-16" },
  { id: 20, company: "The Phone Company",    stage: "Ghosting",     bdr: "Dino",    ae: "Andrew Gordillo", contact: "Ivan Cruz",      meetingDate: "2026-03-24", quote: 22000, notes: "Lost to competitor?", month: "2026-03", confirmed: false, lastContact: "2026-03-24" },
  { id: 21, company: "Bellows College",      stage: "Closed Won",   bdr: "Andrew",  ae: "Sam Noyce",       contact: "Faye Lin",       meetingDate: "2026-04-01", quote: 35000, notes: "Education discount applied", month: "2026-04", confirmed: true,  lastContact: "2026-04-01" },
  { id: 22, company: "Best For You Organics", stage: "Qualified",   bdr: "Luke",    ae: "Gavin Winchell",  contact: "Omar Reed",      meetingDate: "2026-04-04", quote: 24000, notes: "Evaluating vs incumbent", month: "2026-04", confirmed: false, lastContact: "2026-06-17" },
  { id: 23, company: "First Up Consultants", stage: "Meeting Booked", bdr: "Parker", ae: "Garrett Martell", contact: "Zoe Hart",     meetingDate: "2026-04-07", quote: 16000, notes: "Intro deck sent", month: "2026-04", confirmed: false, lastContact: "2026-06-12" },
  { id: 24, company: "Relecloud",            stage: "Quoted",       bdr: "Amos",    ae: "Tor Gordon",      contact: "Marco Diaz",     meetingDate: "2026-04-10", quote: 58000, notes: "Proposal with 2 options", month: "2026-04", confirmed: false, lastContact: "2026-06-16" },
  { id: 25, company: "Southridge Video",     stage: "Closed Won",   bdr: "Jed",     ae: "Alex Frankel",    contact: "Nia Bello",      meetingDate: "2026-04-14", quote: 47000, notes: "Fast close, referral", month: "2026-04", confirmed: true,  lastContact: "2026-04-14" },
  { id: 27, company: "Nod Publishers",       stage: "Qualified",    bdr: "Ben",     ae: "Andrew Gordillo", contact: "Ada Quinn",      meetingDate: "2026-04-19", quote: 29000, notes: "Security review passed", month: "2026-04", confirmed: false, lastContact: "2026-06-15" },
  { id: 28, company: "Wide World Importers", stage: "Ghosting",     bdr: "Daryl",   ae: "Sam Noyce",       contact: "Paul Rees",      meetingDate: "2026-04-22", quote: 20000, notes: "Champion left company", month: "2026-04", confirmed: false, lastContact: "2026-04-22" },
  { id: 29, company: "City Power & Light",   stage: "Closed Won",   bdr: "Gabriel", ae: "Gavin Winchell",  contact: "Tess Moran",     meetingDate: "2026-05-02", quote: 91000, notes: "Biggest deal of quarter", month: "2026-05", confirmed: true,  lastContact: "2026-05-02" },
  { id: 30, company: "Consolidated Messenger", stage: "Quoted",     bdr: "Carwyn",  ae: "Garrett Martell", contact: "Ben Cole",       meetingDate: "2026-05-05", quote: 33000, notes: "Verbal yes, paperwork", month: "2026-05", confirmed: false, lastContact: "2026-06-17" },
  { id: 31, company: "Lamna Healthcare",     stage: "Qualified",    bdr: "Luke",    ae: "Tor Gordon",      contact: "Rosa Vela",      meetingDate: "2026-05-08", quote: 45000, notes: "Compliance requirements clear", month: "2026-05", confirmed: false, lastContact: "2026-06-16" },
  { id: 32, company: "School of Fine Art",   stage: "Meeting Booked", bdr: "Dino",  ae: "Alex Frankel",    contact: "Luca Ferro",     meetingDate: "2026-05-11", quote: 13000, notes: "Demo booked", month: "2026-05", confirmed: false, lastContact: "2026-06-10" },
  { id: 33, company: "Fincher & Co",         stage: "Closed Won",   bdr: "Andrew",  ae: "Matt Elmer",      contact: "Gina Ross",      meetingDate: "2026-05-15", quote: 39000, notes: "Signed mid-month", month: "2026-05", confirmed: true,  lastContact: "2026-05-15" },
  { id: 35, company: "Contorted Living",     stage: "Quoted",       bdr: "Parker",  ae: "Sam Noyce",       contact: "Ivy Dunn",       meetingDate: "2026-05-21", quote: 51000, notes: "Discount requested", month: "2026-05", confirmed: false, lastContact: "2026-06-16" },
  { id: 36, company: "Tall Poppy Co",        stage: "Ghosting",     bdr: "Amos",    ae: "Gavin Winchell",  contact: "Reed Frost",     meetingDate: "2026-05-24", quote: 17000, notes: "Unresponsive post-quote", month: "2026-05", confirmed: false, lastContact: "2026-05-24" },
  { id: 37, company: "Cronus Energy",        stage: "Closed Won",   bdr: "Jed",     ae: "Garrett Martell", contact: "Uma Shah",       meetingDate: "2026-06-01", quote: 64000, notes: "Landed and expanded", month: "2026-06", confirmed: true,  lastContact: "2026-06-01" },
  { id: 38, company: "Fibrous Networks",     stage: "Qualified",    bdr: "Oz",      ae: "Tor Gordon",      contact: "Milo Grant",     meetingDate: "2026-06-04", quote: 28000, notes: "POC in progress", month: "2026-06", confirmed: false, lastContact: "2026-06-17" },
  { id: 39, company: "Orchard Systems",      stage: "Quoted",       bdr: "Ben",     ae: "Alex Frankel",    contact: "Petra Nagy",     meetingDate: "2026-06-08", quote: 42000, notes: "Final approval this week", month: "2026-06", confirmed: false, lastContact: "2026-06-16" },
  { id: 40, company: "Beacon Analytics",     stage: "Meeting Booked", bdr: "Daryl", ae: "Matt Elmer",      contact: "Sean Ferry",     meetingDate: "2026-06-11", quote: 23000, notes: "Second call set", month: "2026-06", confirmed: false, lastContact: "2026-06-16" },
  { id: 41, company: "Halcyon Retail",       stage: "Closed Won",   bdr: "Gabriel", ae: "Andrew Gordillo", contact: "Nadia Rue",      meetingDate: "2026-06-15", quote: 55000, notes: "Q2 flagship close", month: "2026-06", confirmed: true,  lastContact: "2026-06-15" },
];

// ---------------------------------------------------------------------------
// THE API SWAP POINT — now live.
// Asks our own server route (/api/prospects) for the real deals. That route
// talks to HubSpot with the secret key (which never reaches the browser) and
// hands back rows in exactly the Prospect shape above. If the call fails or
// comes back empty, we fall back to the sample rows so the page still works.
// ---------------------------------------------------------------------------
export async function getProspects(): Promise<Prospect[]> {
  try {
    const res = await fetch("/api/prospects", { cache: "no-store" });
    if (!res.ok) throw new Error(`prospects API returned ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data as Prospect[];
    return PROSPECTS;
  } catch {
    return PROSPECTS;
  }
}

// ===========================================================================
// HELPER MATH — turns a list of deals into the numbers the dashboard shows.
// These are "pure" functions: same input in, same numbers out. No surprises.
// ===========================================================================

export type Filters = {
  month: string; // "all" or a value from MONTHS
  bdr: string;   // "all" or a name from BDRS
  ae: string;    // "all" or a name from AES
};

export const DEFAULT_FILTERS: Filters = { month: "all", bdr: "all", ae: "all" };

// Keep only the rows that match the selected filters.
export function filterProspects(rows: Prospect[], f: Filters): Prospect[] {
  return rows.filter(
    (r) =>
      (f.month === "all" || r.month === f.month) &&
      (f.bdr === "all" || r.bdr === f.bdr) &&
      (f.ae === "all" || r.ae === f.ae),
  );
}

// Each funnel card maps to a stage you can filter the deals by ("all" = no filter).
export type FunnelStage = {
  label: string;
  count: number;
  pct: number;
  filter: Stage | "all";
};

// The 6-card funnel. Each card counts the deals sitting in exactly that stage
// right now, so a card's number matches the rows shown when you click it.
export function computeFunnel(rows: Prospect[]): FunnelStage[] {
  const total = rows.length || 1; // avoid divide-by-zero
  // Count by EFFECTIVE stage (Corgi-quote aware) for every card, so no deal is
  // ever counted twice — e.g. a Corgi-quoted deal counts as Quoted only, not
  // also as Qualified — and each card's number matches the rows it opens.
  const inStage = (stage: Stage) =>
    rows.filter((r) => effectiveStage(r) === stage).length;

  // Every deal is at least a booked meeting, so a "Meetings Booked" card would
  // just repeat "Total Deals" — it's deliberately left out of the funnel.
  const totalDeals = rows.length;
  const qualified = inStage("Qualified");
  // "Quoted" is driven by real Corgi/Django quotes, not the HubSpot stage.
  const quoted = inStage("Quoted");
  const won = inStage("Closed Won");
  const ghosting = inStage("Ghosting");
  const lost = inStage("Closed Lost");

  const pct = (n: number) => Math.round((n / total) * 100);

  return [
    { label: "Total Deals", count: totalDeals, pct: 100, filter: "all" },
    { label: "Qualified", count: qualified, pct: pct(qualified), filter: "Qualified" },
    { label: "Quoted", count: quoted, pct: pct(quoted), filter: "Quoted" },
    { label: "Closed Won", count: won, pct: pct(won), filter: "Closed Won" },
    { label: "Ghosting", count: ghosting, pct: pct(ghosting), filter: "Ghosting" },
    { label: "Closed Lost", count: lost, pct: pct(lost), filter: "Closed Lost" },
  ];
}

export type DealValues = {
  pipeline: number;   // value of open deals still in play
  won: number;        // value of Closed Won deals
  avgDeal: number;    // average Closed Won deal size
  confirmed: number;  // Django-confirmed revenue
};

export function computeDealValues(rows: Prospect[]): DealValues {
  const openStages: Stage[] = ["Meeting Booked", "Qualified", "Quoted"];
  const pipeline = sumValue(rows.filter((r) => openStages.includes(r.stage)));
  const wonRows = rows.filter((r) => r.stage === "Closed Won");
  const won = sumValue(wonRows);
  const avgDeal = wonRows.length ? Math.round(won / wonRows.length) : 0;
  // Confirmed revenue = real premiums from purchased Corgi quotes. Sample rows
  // have no premium, so they fall back to the deal amount for the demo.
  const confirmed = sumValue(rows.filter((r) => r.confirmed));
  return { pipeline, won, avgDeal, confirmed };
}

export type QuotaProgress = {
  target: number;
  won: number;
  pct: number; // 0..100+ (can exceed 100)
};

// Team quota vs. Closed Won value. If a single BDR is selected, use the
// per-BDR target instead so the bar makes sense for one person.
export function computeQuota(rows: Prospect[], f: Filters): QuotaProgress {
  const singleBdr = f.bdr !== "all";
  const target = singleBdr ? QUOTA.bdrMonthly : QUOTA.teamMonthly;
  const won = sumValue(rows.filter((r) => r.stage === "Closed Won"));
  const pct = Math.round((won / target) * 100);
  return { target, won, pct };
}

export type RepStat = {
  name: string;
  prospects: number;
  meetings: number;
  quoted: number;
  wonCount: number;
  wonValue: number;
  quotaPct: number;
};

// Per-person cards for either BDRs or AEs. Pass the roster of names to show
// (derived from the live deals). Falls back to the seed lists when not given.
export function computeRepStats(
  rows: Prospect[],
  team: "bdr" | "ae",
  roster?: readonly string[],
  monthly = false,
): RepStat[] {
  const names = roster ?? (team === "bdr" ? DEFAULT_BDRS : AES);
  // When a single month is in view, compare against the MONTHLY quota; when
  // showing all-time totals, compare against the ANNUAL quota (monthly × 12).
  const bdrTarget = monthly ? QUOTA.bdrMonthly : QUOTA.bdrAnnual;
  const teamTarget = monthly ? QUOTA.teamMonthly : QUOTA.teamAnnual;
  const target =
    team === "bdr" ? bdrTarget : teamTarget / (names.length || 1);

  return names.map((name) => {
    const mine = rows.filter((r) => (team === "bdr" ? r.bdr : r.ae) === name);
    const wonRows = mine.filter((r) => r.stage === "Closed Won");
    const wonValue = sumValue(wonRows);
    return {
      name,
      prospects: mine.length,
      meetings: mine.filter((r) => STAGE_RANK[r.stage] >= 1).length,
      quoted: mine.filter(isQuoted).length,
      wonCount: wonRows.length,
      wonValue,
      quotaPct: Math.round((wonValue / target) * 100),
    };
  });
}

// ---- Headline KPIs (the top summary strip) --------------------------------
export type Kpis = {
  pipeline: number; // value of open deals still in play
  won: number;      // value of Closed Won deals
  winRate: number;  // % of decided deals that were won (won vs ghosting)
  avgDeal: number;  // average Closed Won deal size
  deals: number;    // total number of deals in view
};

// One glance at "how are we doing". Win rate = won / (won + ghosting), because
// those are the deals that actually reached a decision.
export function computeKpis(rows: Prospect[]): Kpis {
  const v = computeDealValues(rows);
  const won = rows.filter((r) => r.stage === "Closed Won").length;
  const ghosting = rows.filter((r) => r.stage === "Ghosting").length;
  const decided = won + ghosting;
  return {
    pipeline: v.pipeline,
    won: v.won,
    winRate: decided ? Math.round((won / decided) * 100) : 0,
    avgDeal: v.avgDeal,
    deals: rows.length,
  };
}

// ---- Month-by-month won value (for the trend chart) -----------------------
export type MonthPoint = { month: string; wonValue: number; wonCount: number };

export function computeMonthlyTrend(rows: Prospect[]): MonthPoint[] {
  // Build the month axis from the deals actually in view (so July, August, etc.
  // appear automatically as soon as there are deals in them) instead of a
  // hardcoded list that silently dropped anything past June.
  return monthsFromRows(rows).map((m) => {
    const won = rows.filter((r) => r.month === m && r.stage === "Closed Won");
    return { month: m, wonValue: sumValue(won), wonCount: won.length };
  });
}

// The distinct months present in a set of deals, oldest first (e.g.
// ["2026-05", "2026-06", "2026-07"]). Used to build the month dropdown and the
// trend chart from real data rather than a fixed list.
export function monthsFromRows(rows: Prospect[]): string[] {
  return Array.from(
    new Set(rows.map((r) => r.month).filter((m): m is string => Boolean(m))),
  ).sort();
}

// ---- Automated insights (the text callouts that update with filters) ------
export type InsightTone = "success" | "warning" | "info";
export type Insight = { tone: InsightTone; text: string };

// Full-money formatter kept local so this file never imports from ui.tsx
// (ui.tsx imports from here — importing back would create a circle).
const fmtMoney = (n: number) => `${QUOTA.currency}${n.toLocaleString("en-US")}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Reads the current (already-filtered) rows and writes a few plain-English
// takeaways. Deterministic: same rows in, same sentences out.
export function computeInsights(rows: Prospect[]): Insight[] {
  const out: Insight[] = [];
  if (rows.length === 0) {
    return [{ tone: "info", text: "No deals match the current filters." }];
  }

  const k = computeKpis(rows);
  const openStages: Stage[] = ["Meeting Booked", "Qualified", "Quoted"];
  const open = rows
    .filter((r) => openStages.includes(r.stage))
    .sort((a, b) => b.quote - a.quote);

  // Top-closing BDR by won value (roster derived from the rows in view).
  const bdrRoster = Array.from(new Set(rows.map((r) => r.bdr).filter(Boolean)));
  const topBdr = computeRepStats(rows, "bdr", bdrRoster)
    .filter((s) => s.wonValue > 0)
    .sort((a, b) => b.wonValue - a.wonValue)[0];
  if (topBdr) {
    out.push({
      tone: "success",
      text: `${topBdr.name} leads with ${fmtMoney(topBdr.wonValue)} won across ${plural(topBdr.wonCount, "deal")}.`,
    });
  }

  // Ghosting drag.
  const ghost = rows.filter((r) => r.stage === "Ghosting");
  if (ghost.length) {
    const pct = Math.round((ghost.length / rows.length) * 100);
    const val = sum(ghost, "quote");
    out.push({
      tone: "warning",
      text: `${pct}% of deals are ghosting — ${plural(ghost.length, "deal")} worth ${fmtMoney(val)}.`,
    });
  }

  // Biggest deal still in play.
  if (open.length) {
    const big = open[0];
    out.push({
      tone: "info",
      text: `Largest open deal: ${big.company} at ${fmtMoney(big.quote)} (${big.stage}).`,
    });
  }

  // Win rate, framed as good or worth watching.
  out.push({
    tone: k.winRate >= 50 ? "success" : "warning",
    text: `Win rate is ${k.winRate}% of deals that reached a decision.`,
  });

  // Pipeline still open.
  out.push({
    tone: "info",
    text: `${fmtMoney(k.pipeline)} still in play across ${plural(open.length, "open deal")}.`,
  });

  return out;
}

// ---- Deal health: how "at risk" a deal is by days since last contact ------
export type DealHealth = "won" | "safe" | "warning" | "risk" | "none";

// Whole days between two ISO dates.
function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.floor(ms / 86_400_000);
}

// Days since the last positive contact — null if none has ever been logged.
export function daysSinceContact(p: Prospect, today: string = TODAY): number | null {
  return p.lastContact === null ? null : daysBetween(p.lastContact, today);
}

// A single deal's traffic-light status:
//   won     – closed, celebrate
//   safe    – contacted recently (green)
//   warning – nearly stale, chase soon (amber)
//   risk    – no contact past the threshold, or ghosting (red)
//   none    – no contact logged yet (fresh prospect, neutral)
// Logging a newer lastContact date automatically pulls it back to "safe".
export function dealHealth(p: Prospect, today: string = TODAY): DealHealth {
  if (p.stage === "Closed Won") return "won";
  if (p.stage === "Ghosting" || p.stage === "Closed Lost") return "risk";
  const d = daysSinceContact(p, today);
  // An open deal with no positive contact logged still needs a chase, so it
  // reads amber ("chase soon") rather than sitting there uncoloured.
  if (d === null) return "warning";
  if (d >= STALE_DAYS) return "risk";
  if (d >= WARN_DAYS) return "warning";
  return "safe";
}

// A deal's HubSpot record link. Placeholder per-deal URL for the sample data.
export function hubspotUrl(p: Prospect): string {
  return `${HUBSPOT_BASE}${p.id}`;
}

// Small helper: add up one number field across a list of rows.
function sum(rows: Prospect[], key: "quote"): number {
  return rows.reduce((acc, r) => acc + r[key], 0);
}

// The dollar value we credit to a single deal. Prefer the REAL Corgi/Django
// annual premium when we have one (that's the actual money), otherwise fall
// back to the HubSpot deal amount. This keeps every revenue figure on the
// dashboard — per-BDR, per-AE, leaderboard, trend, confirmed — on the same
// accurate basis.
export function dealValue(p: Prospect): number {
  return p.corgiPremium || p.quote;
}

// Add up dealValue across a list of rows.
function sumValue(rows: Prospect[]): number {
  return rows.reduce((acc, r) => acc + dealValue(r), 0);
}
