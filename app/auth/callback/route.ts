// ============================================================================
// GOOGLE OAUTH CALLBACK  (app/auth/callback/route.ts)
// ----------------------------------------------------------------------------
// Supabase sends the browser here after Google auth succeeds, with a one-time
// `code` param. We exchange it for a session (this sets the Supabase session
// cookies), then check the signed-in email against the allowlist:
//   - allowed     -> send them on to `from` (or the home hub)
//   - not allowed -> sign them back out immediately and bounce to /login with
//                    an error, so an unapproved Google account never actually
//                    gets a working session.
// ============================================================================

import { NextResponse } from "next/server";
import { createClient } from "../../lib/supabase/server";
import { isAllowedEmail } from "../../lib/allowedUsers";

// Only allow redirecting back into the app (mirrors the same guard the
// password-login page uses) — never to an attacker-controlled external URL.
function safeDest(from: string | null): string {
  return from && /^\/(?!\/)/.test(from) ? from : "/";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const dest = safeDest(searchParams.get("from"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  return NextResponse.redirect(`${origin}${dest}`);
}
