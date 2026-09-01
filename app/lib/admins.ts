// ============================================================================
// ADMIN ALLOWLIST  (app/lib/admins.ts)
// ----------------------------------------------------------------------------
// Separate from app/lib/allowedUsers.ts (which just gates "can sign in at
// all"). An admin additionally gets to VIEW AS any rep on the roster — see
// app/api/impersonate/route.ts — so keep this list short and deliberate.
// ============================================================================

export const ADMIN_EMAILS = new Set<string>(
  ["jonathan.duron@corgi.com"].map((e) => e.toLowerCase()),
);

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.trim().toLowerCase());
}
