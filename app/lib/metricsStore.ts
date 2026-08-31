// ============================================================================
// SHARED METRICS STORE — server-side Redis helpers (app/lib/metricsStore.ts)
// ----------------------------------------------------------------------------
// A small, general-purpose layer over the SAME Upstash Redis the manual-quote
// store uses (KV_REST_API_* / UPSTASH_*). It exists to support three HubSpot-API
// optimizations, all of which degrade gracefully to the old behaviour when the
// store is not connected:
//
//   1. CACHE      getJson / setJson — cache immutable results (e.g. a rep's dial
//                 count for a week that has already ended and can never change)
//                 so we don't re-ask HubSpot for the same historical number.
//   2. LOCK       acquireLock / releaseLock — a cross-instance refresh coordinator
//                 so two serverless instances don't both run the same expensive
//                 HubSpot pull at the same time (they share one Redis, unlike the
//                 per-process in-memory locks which each instance owns privately).
//
// NOTHING here changes any figure. Caches only ever hold values that are already
// final (past weeks), and the lock only decides WHO computes — not WHAT. If Redis
// is missing every function no-ops (reads miss, writes skip, locks always grant),
// so the routes fall back to exactly their current behaviour.
// ============================================================================

function creds(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export function storeConfigured(): boolean {
  return creds() !== null;
}

// Fire one Redis command at the Upstash REST endpoint. Returns null on ANY failure
// (missing store, network blip, Redis error) so callers never break — a cache is
// best-effort by definition. The manual-quote store throws on error because a save
// must be confirmed; here every use is optional acceleration, so we swallow.
async function cmd(args: (string | number)[]): Promise<unknown> {
  const c = creds();
  if (!c) return null;
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (data.error) return null;
    return data.result ?? null;
  } catch {
    return null;
  }
}

// --- JSON cache -----------------------------------------------------------

// Read and JSON-parse a cached value, or null on miss / malformed / no store.
export async function getJson<T>(key: string): Promise<T | null> {
  const raw = (await cmd(["GET", key])) as string | null;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Write a value with an expiry (seconds). No-ops when the store is absent.
export async function setJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  await cmd(["SET", key, JSON.stringify(value), "EX", `${Math.max(1, Math.floor(ttlSeconds))}`]);
}

// Read many keys at once (MGET); returns an array aligned to `keys`, with null for
// every miss. One round-trip instead of N — used to look up a batch of already-
// finalised weekly counts in a single call.
export async function getJsonMany<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  const res = (await cmd(["MGET", ...keys])) as (string | null)[] | null;
  if (!Array.isArray(res)) return keys.map(() => null);
  return res.map((raw) => {
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  });
}

// --- Fields hash (for the engagement cache) -------------------------------

// Read specific fields of a hash (HMGET), JSON-parsed. Aligned to `fields`, null
// per miss. Lets the engagement enrichment load many deals' cached results in one
// round-trip and refresh only the stale ones.
export async function hGetJsonMany<T>(
  hashKey: string,
  fields: string[],
): Promise<(T | null)[]> {
  if (fields.length === 0) return [];
  const res = (await cmd(["HMGET", hashKey, ...fields])) as (string | null)[] | null;
  if (!Array.isArray(res)) return fields.map(() => null);
  return res.map((raw) => {
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  });
}

// Write several hash fields at once (HSET field val field val …), each JSON-encoded.
export async function hSetJsonMany(
  hashKey: string,
  entries: Record<string, unknown>,
): Promise<void> {
  const pairs = Object.entries(entries);
  if (pairs.length === 0) return;
  const args: (string | number)[] = ["HSET", hashKey];
  for (const [field, val] of pairs) {
    args.push(field, JSON.stringify(val));
  }
  await cmd(args);
}

// --- Distributed refresh lock ---------------------------------------------

// Try to become the ONE instance that runs an expensive refresh. Uses SET NX with
// an expiry so the lock auto-releases even if the holder crashes mid-pull. Returns
// a token to release it with, or null if someone else holds it (caller should then
// serve stale / wait). When the store is absent this ALWAYS grants (token "local"),
// so a single instance behaves exactly as before.
export async function acquireLock(
  key: string,
  ttlSeconds: number,
): Promise<string | null> {
  if (!storeConfigured()) return "local";
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = (await cmd([
    "SET",
    key,
    token,
    "NX",
    "EX",
    `${Math.max(1, Math.floor(ttlSeconds))}`,
  ])) as string | null;
  // Upstash returns "OK" when the key was set, null when NX failed (already held).
  return res === "OK" ? token : null;
}

// Release a lock, but only if WE still hold it (compare-and-delete via a small Lua
// script) so a lock that already expired and was retaken by another instance is
// never deleted out from under them. Best-effort; a no-op without the store.
export async function releaseLock(key: string, token: string): Promise<void> {
  if (!storeConfigured() || token === "local") return;
  await cmd([
    "EVAL",
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    "1",
    key,
    token,
  ]);
}
