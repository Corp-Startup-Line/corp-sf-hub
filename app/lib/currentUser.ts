// ============================================================================
// CURRENT USER  (app/lib/currentUser.ts)
// ----------------------------------------------------------------------------
// Server-side helper: "who's signed in, right now, on THIS request." Only
// meaningful for a Google (Supabase) session — the legacy shared-password
// login (proxy.ts's other accepted session type) carries no identity at all,
// so it always resolves to `null` here, same as being logged out. That's
// expected: personalization is a Google-login-only feature.
//
// Use from a Route Handler or Server Component. For proxy.ts itself, keep
// using the inline Supabase client already there (see the comment in
// app/lib/supabase/server.ts about why proxy.ts can't use this).
// ============================================================================

import { createClient } from "./supabase/server";

export type CurrentUser = { email: string; name: string | null };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const name =
    (typeof meta?.full_name === "string" && meta.full_name) ||
    (typeof meta?.name === "string" && meta.name) ||
    null;
  return { email: user.email, name };
}
