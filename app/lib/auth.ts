// ============================================================================
// SHARED PASSWORD GATE — server-only auth helpers (app/lib/auth.ts)
// ----------------------------------------------------------------------------
// The whole site sits behind ONE shared password, stored server-side in the
// SITE_PASSWORD env var (never shipped to the browser). When you type the right
// password we hand back a signed cookie (a "session token") that proves you
// authenticated; the proxy (proxy.ts) checks that cookie on every request.
//
// The token is NOT the password — it's an HMAC (a one-way signature) of a fixed
// phrase, keyed by the password. So the token can't be reversed back into the
// password, and it can't be forged by anyone who doesn't know the password.
// Change SITE_PASSWORD and every old cookie stops working automatically.
// ============================================================================

import crypto from "node:crypto";

// Cookie name that holds the session token, and how long it lasts (30 days) so
// you don't retype the password every visit.
export const AUTH_COOKIE = "corgi_auth";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30; // seconds

// The shared password, read server-side only. Undefined if it hasn't been set
// (locally in .env.local, or in the Vercel project's Environment Variables).
export function getSitePassword(): string | undefined {
  return process.env.SITE_PASSWORD || undefined;
}

// Hash a string to a fixed 32 bytes so comparisons are constant-time AND don't
// leak the length of the real password/token.
function digest(s: string): Buffer {
  return crypto.createHash("sha256").update(s).digest();
}

// Constant-time string compare (timing-attack safe): always compares fixed-size
// hashes so an attacker can't learn the secret from how long the check takes.
function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

// The session token for a given password: HMAC-SHA256 of a fixed phrase, keyed
// by the password. Deterministic, one-way, unforgeable without the password.
export function sessionToken(password: string): string {
  return crypto
    .createHmac("sha256", password)
    .update("corgi-auth-v1")
    .digest("hex");
}

// Does the typed password match the configured one? False if none is set.
export function passwordMatches(input: string): boolean {
  const pw = getSitePassword();
  if (!pw) return false;
  return safeEqual(input, pw);
}

// Is this cookie value a valid session token for the current password? False if
// there's no cookie or no password configured (fail closed).
export function tokenIsValid(token: string | undefined): boolean {
  const pw = getSitePassword();
  if (!pw || !token) return false;
  return safeEqual(token, sessionToken(pw));
}
