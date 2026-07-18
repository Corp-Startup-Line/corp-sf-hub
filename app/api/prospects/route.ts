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

// Always run fresh on each request (read the live key + live deals), never
// cached at build time.
export const dynamic = "force-dynamic";

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
): Prospect | null {
  const p = d.properties;
  const stage = STAGE_BY_HUBSPOT[p.dealstage ?? ""];
  if (!stage) return null; // stage we don't track → skip

  // The search already limited results to our team's BDRs, so just resolve
  // the display names. Keep the on-team guard as a belt-and-braces check.
  const bdr = p.bdr ? id2name.get(p.bdr) ?? "Unassigned" : "Unassigned";
  if (!TEAM_BDRS.has(bdr)) return null;
  const ae = p.hubspot_owner_id
    ? id2name.get(p.hubspot_owner_id) ?? "Unassigned"
    : "Unassigned";
  const when = p.closedate || p.createdate || "";

  return {
    id: Number(d.id),
    company: (p.dealname ?? "Untitled").replace(/\s*-\s*New Deal\s*$/i, "").trim(),
    stage,
    bdr,
    ae,
    contact: "",
    meetingDate: toDate(p.createdate),
    quote: Math.round(Number(p.amount) || 0),
    notes: "",
    month: when.slice(0, 7), // "YYYY-MM"
    confirmed: stage === "Closed Won", // placeholder until Corgi/Django is wired
    lastContact: toDate(p.notes_last_contacted),
  };
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
  const deals = await searchTeamDeals(token, bdrIds);
  return deals
    .map((d) => mapDeal(d, id2name))
    .filter((x): x is Prospect => x !== null);
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
