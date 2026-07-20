// ============================================================================
// SERVER ROUTE: /api/prospects  (app/api/prospects/route.ts)
// ----------------------------------------------------------------------------
// Runs ONLY on the server, so the secret HubSpot key never reaches the browser.
// It asks HubSpot's Search API for just our team's deals, translates HubSpot's
// field names + codes into the exact `Prospect` shape the dashboard already
// understands, and hands back a plain list. The result is cached for a few
// minutes so repeat visits are instant. The browser fetches this via
// getProspects() in data.ts.
// ============================================================================

import type { Prospect, Stage } from "../../lib/data";
import {
  getCorgiIndex,
  matchCompany,
  normalizeCompany,
  type CorgiCompany,
} from "./corgi";
import { enrichEngagements, type Engagement } from "./engagements";

// Always run fresh on each request (read the live key + live deals), never
// cached at build time.
export const dynamic = "force-dynamic";
// Corgi's API can only be paged (no company filter) and throttles hard, so a
// cold pull of all quotes takes ~30s. Allow up to 60s so Vercel doesn't cut it
// off; after the first pull it's cached in memory and responses are instant.
export const maxDuration = 60;

const HUBSPOT_BASE = "https://api.hubapi.com";

// How long to reuse a fetched result before going back to HubSpot. Keeps the
// dashboard fast on repeat loads without showing badly stale numbers.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// YOUR BDR team — only deals whose HubSpot "BDR" field is one of these people
// show in the dashboard. Everyone else's / company-wide deals are ignored.
// Names must match the HubSpot owner's full name exactly. Edit this list to
// add or remove a teammate.
const TEAM_BDRS = new Set([
  "Jed Clark",
  "Oz Harkavi",
  "Ben Boneham",
  "Daryl Wilson",
  "Gabriel Serrano",
  "Carwyn Chiramel",
  "Luke Jopling",
  "Dino Citti",
  "Andrew Bagasbas",
  "Parker Horton",
  "Amos Book",
]);

// YOUR AE team — a deal's "owner" in HubSpot is the AE. Only these six people
// are corp AEs; any other owner (including BDRs who happen to own a deal) is
// shown as "Unassigned" on the AE side so they don't clutter the AE cards.
// Names must match the HubSpot owner's full name exactly.
const TEAM_AES = new Set([
  "Matthew Elmer", // "Matt" in HubSpot is registered as Matthew Elmer
  "Alex Frankel",
  "Drew Gordillo",
  "Tor Gordon",
  "Gavin Winchell",
  "Garrett Martel", // HubSpot spelling (garrett@corgi.insure)
  "Samuel Noyce", // "Sam" in HubSpot is registered as Samuel Noyce
]);

// HubSpot's internal stage IDs → the dashboard's stage names.
// (Mapping confirmed with Carwyn: Contract Sent folds into Quoted; HubSpot's
// "Closed Lost" shows as Ghosting; HubSpot's "Disqualified" shows as Closed Lost.)
const STAGE_BY_HUBSPOT: Record<string, Stage> = {
  contractsent: "Meeting Booked", // labelled "Booked" in HubSpot
  qualifiedtobuy: "Qualified", // labelled "Discovery"
  "2808562411": "Quoted",
  "3653087972": "Quoted", // "Contract Sent"
  closedwon: "Closed Won",
  closedlost: "Ghosting",
  "3448964848": "Closed Lost", // "Disqualified"
};

const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "dealstage",
  "bdr",
  "hubspot_owner_id",
  "notes_last_contacted",
  "closedate",
  "createdate",
];

type HubSpotDeal = {
  id: string;
  properties: Record<string, string | null>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Small helper: call HubSpot with the bearer token and return parsed JSON.
// Retries on rate-limits (429) and transient 5xx with a short backoff, so a
// burst of requests doesn't break the page. `init` lets us do POST (search).
async function hs(
  path: string,
  token: string,
  init?: RequestInit,
  attempt = 0,
): Promise<any> {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.ok) return res.json();

  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < 5) {
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    const wait = retryAfter * 1000 || Math.min(500 * 2 ** attempt, 8000);
    await sleep(wait);
    return hs(path, token, init, attempt + 1);
  }

  const body = await res.text();
  throw new Error(`HubSpot ${res.status} on ${path}: ${body.slice(0, 200)}`);
}

// Build owner lookups from HubSpot's user list. Returns both directions:
//   id2name — user ID → "First Last" (for showing the AE/BDR name)
//   name2id — "First Last" → user ID (to look up our team's BDR IDs)
async function fetchOwners(token: string): Promise<{
  id2name: Map<string, string>;
  name2id: Map<string, string>;
}> {
  const id2name = new Map<string, string>();
  const name2id = new Map<string, string>();
  let after: string | undefined;
  do {
    const q = `/crm/v3/owners?limit=100${after ? `&after=${after}` : ""}`;
    const page = await hs(q, token);
    for (const o of page.results ?? []) {
      const id = String(o.id);
      const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
      const display = name || o.email || `User ${id}`;
      id2name.set(id, display);
      if (name) name2id.set(name, id);
    }
    after = page.paging?.next?.after;
  } while (after);
  return { id2name, name2id };
}

// Ask HubSpot's Search API for ONLY the deals whose BDR field is one of the
// given user IDs. This returns just our team's ~1.5k deals instead of every
// company deal, so it's far fewer pages to fetch.
async function searchTeamDeals(
  token: string,
  bdrIds: string[],
): Promise<HubSpotDeal[]> {
  const deals: HubSpotDeal[] = [];
  let after: string | undefined;
  let guard = 0;
  do {
    const body = {
      filterGroups: [
        { filters: [{ propertyName: "bdr", operator: "IN", values: bdrIds }] },
      ],
      properties: DEAL_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    };
    const page = await hs("/crm/v3/objects/deals/search", token, {
      method: "POST",
      body: JSON.stringify(body),
    });
    deals.push(...(page.results ?? []));
    after = page.paging?.next?.after;
  } while (after && ++guard < 120); // search caps at 10k results
  return deals;
}

// Turn "2026-06-18T17:32:04Z" into "2026-06-18" (or null).
function toDate(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

function mapDeal(
  d: HubSpotDeal,
  id2name: Map<string, string>,
  corgi: Map<string, CorgiCompany> | null,
): Prospect | null {
  const p = d.properties;
  const stage = STAGE_BY_HUBSPOT[p.dealstage ?? ""];
  if (!stage) return null; // stage we don't track → skip

  // The search already limited results to our team's BDRs, so just resolve
  // the display names. Keep the on-team guard as a belt-and-braces check.
  const bdr = p.bdr ? id2name.get(p.bdr) ?? "Unassigned" : "Unassigned";
  if (!TEAM_BDRS.has(bdr)) return null;
  const ownerName = p.hubspot_owner_id
    ? id2name.get(p.hubspot_owner_id) ?? "Unassigned"
    : "Unassigned";
  // Only surface corp AEs; anyone else's name becomes "Unassigned" so they
  // don't appear as an AE card/filter option (the deal itself is kept).
  const ae = TEAM_AES.has(ownerName) ? ownerName : "Unassigned";
  const when = p.closedate || p.createdate || "";

  const company = (p.dealname ?? "Untitled")
    .replace(/\s*-\s*New Deal\s*$/i, "")
    .trim();
  // Look up THIS company's Corgi/Django record (all its quotes). When the Corgi
  // index is unavailable (null), leave the quote fields undefined so the
  // dashboard falls back to the HubSpot deal amount instead of showing zeroes.
  const c = corgi ? matchCompany(corgi, company) : null;
  const base: Prospect = {
    id: Number(d.id),
    company,
    stage,
    bdr,
    ae,
    contact: "",
    meetingDate: toDate(p.createdate),
    quote: Math.round(Number(p.amount) || 0),
    notes: "",
    month: when.slice(0, 7), // "YYYY-MM"
    confirmed: stage === "Closed Won", // fallback until Corgi says otherwise
    lastContact: toDate(p.notes_last_contacted),
  };
  if (!corgi) return base; // Corgi unavailable → stage-based fallback only

  // The actual premium is filled in AFTER de-duping (distributeCorgiRevenue),
  // because a company's purchased policies are spread across its surviving deals
  // there — doing it per-deal here would copy one company's total onto each of
  // its deals and double-count. corgiRevenueResolved marks deals whose value
  // Corgi owns (so a $0 there means "no policy", not "fall back to HubSpot").
  return {
    ...base,
    confirmed: c?.hasPurchased ?? false, // refined per-deal after distribution
    hasCorgiQuote: c?.hasQuote ?? false, // Corgi/Django has a quote for it
    corgiStatus: c?.status ?? null,
    corgiPremium: 0,
    corgiQuotedPremium: c?.quotedPremium ?? 0, // amount quoted (not yet sold)
    corgiRevenueResolved: false,
  };
}

// Manual ownership calls for genuine data ties. When one Corgi policy could
// belong to either of two IDENTICAL Closed Won deals (same company, same
// amount) owned by different BDRs, nothing in HubSpot or Corgi can tell them
// apart, so the nearest-amount match is a coin-flip. These overrides record who
// the policy actually belongs to. Keyed by normalised company name → the BDR's
// full HubSpot name. Mainstay Digital: confirmed by Carwyn as his deal.
const OWNERSHIP_OVERRIDES: Record<string, string> = {
  [normalizeCompany("Mainstay Digital")]: "Carwyn Chiramel",
};

// ----------------------------------------------------------------------------
// Spread each company's PURCHASED Corgi policies across its (de-duped) HubSpot
// deals. One deal + one company total is the common case. When a company has
// several deals (e.g. AdvisorGenie's two policies), each policy is credited to
// the deal whose HubSpot amount is closest to it — so the company total is
// preserved exactly and no policy is ever counted on two deals. Deals in a
// Corgi-covered company that receive no policy show $0 (Corgi is authoritative);
// companies with no purchased policy are left for the HubSpot-amount fallback.
// ----------------------------------------------------------------------------
function distributeCorgiRevenue(
  rows: Prospect[],
  corgi: Map<string, CorgiCompany> | null,
): Prospect[] {
  if (!corgi) return rows;

  const groups = new Map<string, Prospect[]>();
  for (const r of rows) {
    const key = normalizeCompany(r.company);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  for (const [key, deals] of groups) {
    const c = corgi.get(key);
    if (!c || c.purchasedPremiums.length === 0) continue; // HubSpot fallback

    // A purchased policy is confirmed (won) money, so Corgi owns EVERY one of
    // this company's Closed Won deals (open/ghosted deals keep their HubSpot
    // pipeline amount). Mark them all resolved with $0 up front; the ones that
    // draw a policy below get their premium, and the rest stay at $0 rather than
    // falling back to the HubSpot amount (which would double-count the policy).
    const wonDeals = deals.filter((d) => d.stage === "Closed Won");
    const owned = wonDeals.length ? wonDeals : deals;
    for (const d of owned) {
      d.corgiPremium = 0;
      d.confirmed = false;
      d.corgiRevenueResolved = true;
    }

    // Which owned deals actually RECEIVE the premiums. A manual ownership call
    // (e.g. Mainstay Digital) pins a genuine tie to one rep so the policy lands
    // on the right BDR instead of whichever identical deal sorted first;
    // otherwise every owned deal competes for the nearest-amount match.
    let candidates = owned;
    const owner = OWNERSHIP_OVERRIDES[key];
    if (owner) {
      const pinned = owned.filter((d) => d.bdr === owner);
      if (pinned.length) candidates = pinned;
    }

    if (candidates.length === 1) {
      candidates[0].corgiPremium = c.purchasedSum;
      candidates[0].confirmed = true;
      candidates[0].corgiRevenueResolved = true;
      continue;
    }

    // Several won deals for one company: give each policy to the won deal whose
    // HubSpot amount is nearest, biggest policies first. The company total is
    // preserved and no policy is counted twice; a won deal that draws no policy
    // shows $0 (Corgi says there's no separate bought policy behind it).
    const premiums = [...c.purchasedPremiums].sort((a, b) => b - a);
    const totals = new Map<number, number>(candidates.map((d) => [d.id, 0]));
    for (const prem of premiums) {
      let best = candidates[0];
      let bestDiff = Infinity;
      for (const d of candidates) {
        const diff = Math.abs((d.quote || 0) - prem);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = d;
        }
      }
      totals.set(best.id, Math.round((totals.get(best.id)! + prem) * 100) / 100);
    }
    for (const d of candidates) {
      d.corgiPremium = totals.get(d.id) ?? 0;
      d.confirmed = d.corgiPremium > 0;
      d.corgiRevenueResolved = true;
    }
  }
  return rows;
}

// ----------------------------------------------------------------------------
// De-duplicating deals. HubSpot often holds the same company twice: one real
// deal plus an empty "shell" (amount 0, still sitting in an early stage). Left
// alone they show up as two rows and inflate the funnel counts. We collapse
// every company down to ONE deal — keeping whichever is "most real".
// ----------------------------------------------------------------------------

// How advanced each stage is (higher = further along, so more "real").
const STAGE_PRIORITY: Record<Stage, number> = {
  "Closed Won": 5,
  Quoted: 4,
  Qualified: 3,
  "Meeting Booked": 2,
  Ghosting: 1,
  "Closed Lost": 0,
};

// A ranked "realness" fingerprint for a deal, compared field-by-field:
// confirmed money first, then having a real Corgi quote, then how far along the
// stage is, then the deal amount. Bigger wins on the first field that differs.
function realness(p: Prospect): number[] {
  return [
    p.confirmed ? 1 : 0,
    p.hasCorgiQuote ? 1 : 0,
    STAGE_PRIORITY[p.stage] ?? 0,
    p.quote || 0,
  ];
}

function moreReal(a: Prospect, b: Prospect): boolean {
  const ra = realness(a);
  const rb = realness(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i];
  }
  return false;
}

// An empty "shell" deal: no confirmed money, no Corgi quote, not won, and a
// zero amount. These are the throwaway duplicates HubSpot leaves behind — safe
// to drop when a real deal exists for the same company. A deal that is ANY of
// won / quoted / has-an-amount is "real" and is NEVER dropped, so no genuine
// Closed Won (or other real deal) can ever go missing.
function isShell(p: Prospect): boolean {
  return (
    !p.confirmed &&
    !p.hasCorgiQuote &&
    p.stage !== "Closed Won" &&
    (p.quote || 0) === 0
  );
}

// Collapse duplicate company rows. Within each company we keep every REAL deal
// (so two genuine wins both survive) and throw away only the empty shells. If a
// company somehow has nothing but shells, we keep the single most-real one so
// the company still shows up once.
function dedupeByCompany(rows: Prospect[]): Prospect[] {
  const groups = new Map<string, Prospect[]>();
  for (const r of rows) {
    const key = r.company.trim().toLowerCase();
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const out: Prospect[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const real = group.filter((r) => !isShell(r));
    if (real.length > 0) {
      out.push(...real); // keep all genuine deals, drop the shells
    } else {
      // all shells → keep just the most-real of them so the company still shows
      out.push([...group].sort((a, b) => (moreReal(a, b) ? -1 : 1))[0]);
    }
  }
  return out;
}

// In-memory cache shared across requests on the same server instance. Holds the
// last successful result so repeat visits within CACHE_TTL_MS skip HubSpot.
let cache: { at: number; data: Prospect[] } | null = null;
// If a fetch is already in flight, everyone waits on the same promise instead
// of each kicking off their own HubSpot run.
let inFlight: Promise<Prospect[]> | null = null;

async function loadProspects(token: string): Promise<Prospect[]> {
  const { id2name, name2id } = await fetchOwners(token);
  // Turn our team's names into HubSpot user IDs for the search filter.
  const bdrIds = [...TEAM_BDRS]
    .map((name) => name2id.get(name))
    .filter((id): id is string => Boolean(id));
  // Fetch the team's deals and the Corgi quote index side by side. If Corgi is
  // unavailable, getCorgiIndex() returns an empty map and deals still load.
  const [deals, corgi] = await Promise.all([
    searchTeamDeals(token, bdrIds),
    getCorgiIndex(),
  ]);
  const mapped = deals
    .map((d) => mapDeal(d, id2name, corgi))
    .filter((x): x is Prospect => x !== null);
  // Collapse duplicate company rows, THEN spread each company's purchased Corgi
  // policies across the surviving deals (so nothing is double-counted).
  const rows = distributeCorgiRevenue(dedupeByCompany(mapped), corgi);

  // Attach the customer/BDR contact dates from HubSpot engagements (calls +
  // incoming emails). Best-effort and only for the deals we actually show, so a
  // slow or failed enrichment never blocks the deals themselves.
  const bdrOwnerIds = new Set(bdrIds); // our BDRs' HubSpot user ids
  const engagements = await enrichEngagements(
    token,
    rows.map((r) => String(r.id)),
    (ownerId) => Boolean(ownerId) && bdrOwnerIds.has(ownerId!),
  );
  for (const r of rows) {
    const e: Engagement | undefined = engagements.get(String(r.id));
    r.lastInbound = e?.lastInbound ?? null;
    r.lastBdrOutbound = e?.lastBdrOutbound ?? null;
  }
  return rows;
}

export async function GET() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return Response.json(
      { error: "HUBSPOT_TOKEN is not set on the server." },
      { status: 500 },
    );
  }

  // Fresh cache → return instantly.
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return Response.json(cache.data);
  }

  try {
    // Coalesce concurrent requests onto one HubSpot run.
    if (!inFlight) {
      inFlight = loadProspects(token).then((data) => {
        cache = { at: Date.now(), data };
        return data;
      });
    }
    const prospects = await inFlight;
    return Response.json(prospects);
  } catch (err) {
    // On failure, serve the last good cache if we have one.
    if (cache) return Response.json(cache.data);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  } finally {
    inFlight = null;
  }
}
