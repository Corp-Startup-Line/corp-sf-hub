// ============================================================================
// SERVER ROUTE: /api/prospects  (app/api/prospects/route.ts)
// ----------------------------------------------------------------------------
// Runs ONLY on the server, so the secret HubSpot key never reaches the browser.
// It pulls every deal from HubSpot, translates HubSpot's field names + codes
// into the exact `Prospect` shape the dashboard already understands, and hands
// back a plain list. The browser fetches this via getProspects() in data.ts.
// ============================================================================

import type { Prospect, Stage } from "../../lib/data";

// Always run fresh on each request (read the live key + live deals), never
// cached at build time.
export const dynamic = "force-dynamic";

const HUBSPOT_BASE = "https://api.hubapi.com";

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
// burst of requests doesn't break the page.
async function hs(path: string, token: string, attempt = 0): Promise<any> {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.ok) return res.json();

  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < 5) {
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    const wait = retryAfter * 1000 || Math.min(500 * 2 ** attempt, 8000);
    await sleep(wait);
    return hs(path, token, attempt + 1);
  }

  const body = await res.text();
  throw new Error(`HubSpot ${res.status} on ${path}: ${body.slice(0, 200)}`);
}

// Build an owner-ID → "First Last" (or email) lookup. HubSpot user IDs power
// both the deal owner (our AE) and the custom BDR field.
async function fetchOwnerNames(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let after: string | undefined;
  do {
    const q = `/crm/v3/owners?limit=100${after ? `&after=${after}` : ""}`;
    const page = await hs(q, token);
    for (const o of page.results ?? []) {
      const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
      map.set(String(o.id), name || o.email || `User ${o.id}`);
    }
    after = page.paging?.next?.after;
  } while (after);
  return map;
}

// Page through every deal.
async function fetchAllDeals(token: string): Promise<HubSpotDeal[]> {
  const props = DEAL_PROPERTIES.join(",");
  const deals: HubSpotDeal[] = [];
  let after: string | undefined;
  let guard = 0;
  do {
    const q = `/crm/v3/objects/deals?limit=100&properties=${props}${after ? `&after=${after}` : ""}`;
    const page = await hs(q, token);
    deals.push(...(page.results ?? []));
    after = page.paging?.next?.after;
  } while (after && ++guard < 100); // hard cap ~10k deals, just in case
  return deals;
}

// Turn "2026-06-18T17:32:04Z" into "2026-06-18" (or null).
function toDate(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

function mapDeal(
  d: HubSpotDeal,
  owners: Map<string, string>,
): Prospect | null {
  const p = d.properties;
  const stage = STAGE_BY_HUBSPOT[p.dealstage ?? ""];
  if (!stage) return null; // stage we don't track → skip

  const bdr = p.bdr ? owners.get(p.bdr) ?? "Unassigned" : "Unassigned";
  const ae = p.hubspot_owner_id
    ? owners.get(p.hubspot_owner_id) ?? "Unassigned"
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

export async function GET() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return Response.json(
      { error: "HUBSPOT_TOKEN is not set on the server." },
      { status: 500 },
    );
  }

  try {
    const owners = await fetchOwnerNames(token);
    const deals = await fetchAllDeals(token);
    const prospects = deals
      .map((d) => mapDeal(d, owners))
      .filter((x): x is Prospect => x !== null);
    return Response.json(prospects);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
