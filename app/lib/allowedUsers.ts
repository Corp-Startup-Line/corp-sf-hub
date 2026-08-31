// ============================================================================
// GOOGLE LOGIN ALLOWLIST  —  the ONE place to add or remove who can sign in
// ----------------------------------------------------------------------------
// Anyone can attempt to sign in with Google, but only an email on this list is
// actually let past /auth/callback (see app/auth/callback/route.ts). Everyone
// else's Google session is immediately signed back out.
//
//   • TO ADD someone:    add their exact Google-account email on a new line.
//   • TO REMOVE someone: delete their line.
//
// After editing, the change goes live once the site redeploys.
// ============================================================================

export const ALLOWED_EMAILS = new Set<string>(
  [
    "jonathan.duron@corgi.com",
    // add teammates here
  ].map((e) => e.toLowerCase()),
);

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && ALLOWED_EMAILS.has(email.trim().toLowerCase());
}
