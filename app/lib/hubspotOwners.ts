// ============================================================================
// HUBSPOT OWNER LOOKUP  (app/lib/hubspotOwners.ts)
// ----------------------------------------------------------------------------
// Maps an email address to its HubSpot owner record (id + display name). This
// is the piece that turns "who's signed in with Google" (app/lib/currentUser.ts)
// into "which rep's data should this person see" — the roster itself already
// keys everything (dials, ARR, the leaderboard) by HubSpot owner id/email (see
// sfOwners() in app/api/sf-metrics/route.ts), so this is the missing link.
//
// Deliberately its own small fetch (not reusing sf-metrics' sfOwners()) since
// that function also applies the SF_REPS roster filter, which is specific to
// the metrics dashboards — this one needs EVERY HubSpot owner, so someone
// outside that roster can still be matched.
// ============================================================================

import { TEAM_BDR_NAMES, TEAM_AE_NAMES } from "../api/prospects/team";

const API = "https://api.hubapi.com";
const TOKEN = process.env.HUBSPOT_TOKEN;

export type HubspotOwner = { id: string; name: string; email: string };

// Owners change rarely; cache the full list in memory for a few minutes so a
// burst of /api/me calls doesn't each re-fetch from HubSpot.
const CACHE_MS = 5 * 60_000;
let cache: { at: number; owners: HubspotOwner[] } | null = null;

async function fetchAllOwners(): Promise<HubspotOwner[]> {
  if (!TOKEN) return [];
  const out: HubspotOwner[] = [];
  let after = "";
  do {
    const res = await fetch(
      `${API}/crm/v3/owners?limit=100${after ? `&after=${after}` : ""}`,
      { headers: { Authorization: `Bearer ${TOKEN}` }, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`${res.status} /crm/v3/owners: ${await res.text()}`);
    const j = await res.json();
    for (const o of j.results || []) {
      const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email;
      if (o.email) out.push({ id: o.id, name, email: `${o.email}`.toLowerCase() });
    }
    after = j.paging?.next?.after || "";
  } while (after);
  return out;
}

async function allOwners(): Promise<HubspotOwner[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.owners;
  const owners = await fetchAllOwners();
  cache = { at: Date.now(), owners };
  return owners;
}

// Case-insensitive match on the owner's HubSpot email. Returns null when
// HubSpot isn't configured, the lookup fails, or no owner has this email.
export async function getOwnerByEmail(email: string): Promise<HubspotOwner | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  try {
    const owners = await allOwners();
    return owners.find((o) => o.email === target) ?? null;
  } catch {
    return null;
  }
}

// Look up one owner by their HubSpot id — used to verify an admin's
// impersonation request actually names a real owner (see
// app/api/impersonate/route.ts) rather than trusting a client-supplied name.
export async function getOwnerById(id: string): Promise<HubspotOwner | null> {
  try {
    const owners = await allOwners();
    return owners.find((o) => o.id === id) ?? null;
  } catch {
    return null;
  }
}

// Every BDR/AE on the team roster (app/api/prospects/team.ts), matched to
// their real HubSpot owner record by name. Powers the admin "view as"
// dropdown (app/components/AdminImpersonate.tsx) — deliberately scoped to
// just the roster, not all 130 HubSpot owners, since those are the only
// people whose data the dashboards actually track.
export async function getRosterOwners(): Promise<HubspotOwner[]> {
  const rosterNames = new Set(
    [...TEAM_BDR_NAMES, ...TEAM_AE_NAMES].map((n) => n.toLowerCase()),
  );
  try {
    const owners = await allOwners();
    const seen = new Set<string>();
    const out: HubspotOwner[] = [];
    for (const o of owners) {
      if (!rosterNames.has(o.name.toLowerCase()) || seen.has(o.id)) continue;
      seen.add(o.id);
      out.push(o);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
