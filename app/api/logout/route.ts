// ============================================================================
// SERVER ROUTE: /api/logout  (app/api/logout/route.ts)
// ----------------------------------------------------------------------------
// Clears BOTH possible sessions, since a person could be signed in either way:
// the legacy shared-password cookie, and any Supabase (Google) session. Works
// no matter which path they logged in through.
// ============================================================================

import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "../../lib/auth";
import { createClient } from "../../lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: AUTH_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
