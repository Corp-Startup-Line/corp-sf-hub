// ============================================================================
// MANUAL QUOTE STORE — shared, server-side (app/lib/quoteStore.ts)
// ----------------------------------------------------------------------------
// A tiny persistent overlay so anyone on the team can jot a manual quote onto a
// deal in the table and have EVERYONE see it (and edit it). It is DISPLAY-ONLY:
// nothing in here ever touches ARR, Closed Won, or any money total — those stay
// driven entirely by HubSpot. This file only remembers, per HubSpot deal id, the
// number someone typed, who typed it, and when.
//
// WHERE IT'S STORED: a single Redis hash on Upstash (the same managed key-value
// store Vercel provisions under "Storage → Upstash Redis / KV"). We talk to it
// over its REST API with plain fetch — no extra npm package. Data lives outside
// the app, so it survives every redeploy and is shared across all users.
//
// IF THE STORE ISN'T CONNECTED YET: every function degrades gracefully — reads
// return an empty map and writes throw "store-not-configured" — so the site
// keeps working and the feature simply stays dormant until the store is linked.
// The route surfaces that state to the UI. Setup is two clicks in Vercel:
//   1. Vercel → project → Storage → Create Database → Upstash Redis → connect.
//      (auto-adds KV_REST_API_URL + KV_REST_API_TOKEN to every environment)
//   2. Redeploy. For local dev: `vercel env pull .env.local`.
// ============================================================================

// One saved manual quote: the dollar amount, the free-text name of whoever last
// edited it (trust-based — there are no per-user logins), and an ISO timestamp.
export type ManualQuoteEntry = { value: number; by: string; at: string };
export type ManualQuoteMap = Record<string, ManualQuoteEntry>;

// The single Redis hash that holds every manual quote, keyed by HubSpot deal id.
const HASH_KEY = "corgi:manual-quotes";

// Read the store's REST credentials from the environment. Vercel's Upstash/KV
// integration injects KV_REST_API_*; a direct Upstash setup uses UPSTASH_*. We
// accept either so the feature works however the store was connected. Returns
// null when neither pair is present (store not connected yet).
function creds(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

// Is the shared store connected? The UI uses this to know whether saving will
// work, so it can show a "connect the store" hint instead of failing silently.
export function storeConfigured(): boolean {
  return creds() !== null;
}

// Fire one Redis command at the Upstash REST endpoint. The body is a JSON array
// like ["HSET", key, field, value]; the response is { result } or { error }.
async function cmd(args: (string | number)[]): Promise<unknown> {
  const c = creds();
  if (!c) throw new Error("store-not-configured");
  const res = await fetch(c.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`store HTTP ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(`store error: ${data.error}`);
  return data.result;
}

// Every saved manual quote, keyed by HubSpot deal id. HGETALL returns a flat
// [field, value, field, value, …] array; we pair it back up and JSON-parse each
// stored entry. Malformed rows are skipped rather than breaking the whole read.
export async function getAllQuotes(): Promise<ManualQuoteMap> {
  if (!storeConfigured()) return {};
  const flat = (await cmd(["HGETALL", HASH_KEY])) as string[] | null;
  const out: ManualQuoteMap = {};
  if (Array.isArray(flat)) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      try {
        const entry = JSON.parse(flat[i + 1]) as ManualQuoteEntry;
        if (entry && typeof entry.value === "number") out[flat[i]] = entry;
      } catch {
        // skip a malformed stored value; the rest of the map still loads
      }
    }
  }
  return out;
}

// Save (create or overwrite) the manual quote for one deal, stamping who edited
// it and the current time. Returns the stored entry so the caller can echo it
// straight back to the browser.
export async function setQuote(
  id: string,
  value: number,
  by: string,
): Promise<ManualQuoteEntry> {
  const entry: ManualQuoteEntry = { value, by, at: new Date().toISOString() };
  await cmd(["HSET", HASH_KEY, id, JSON.stringify(entry)]);
  return entry;
}

// Remove a deal's manual quote entirely (used when someone clears the field).
export async function clearQuote(id: string): Promise<void> {
  await cmd(["HDEL", HASH_KEY, id]);
}
