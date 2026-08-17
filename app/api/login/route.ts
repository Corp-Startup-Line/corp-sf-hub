// ============================================================================
// SERVER ROUTE: /api/login  (app/api/login/route.ts)
// ----------------------------------------------------------------------------
// The ONLY place the password is checked. The browser POSTs { password }; if it
// matches SITE_PASSWORD we set an httpOnly session cookie (so JavaScript can't
// read it) and the proxy lets the user through from then on. A wrong password
// just returns 401 with no detail — it never hints how close the guess was.
// ============================================================================

import { NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  AUTH_MAX_AGE,
  getSitePassword,
  passwordMatches,
  sessionToken,
} from "../../lib/auth";

export async function POST(request: Request) {
  const pw = getSitePassword();
  if (!pw) {
    // Misconfigured server (no SITE_PASSWORD) — say so plainly so it's easy to
    // diagnose, rather than silently rejecting every correct password.
    return NextResponse.json(
      { error: "Login isn't configured yet (SITE_PASSWORD is not set)." },
      { status: 500 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!passwordMatches(password)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: AUTH_COOKIE,
    value: sessionToken(pw),
    httpOnly: true, // JS in the browser can't read it
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  return res;
}
