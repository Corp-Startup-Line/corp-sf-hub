// ============================================================================
// PROXY — the site-wide password gate (proxy.ts)
// ----------------------------------------------------------------------------
// In Next.js 16 this file used to be called "middleware". It runs on the server
// BEFORE every request reaches a page, dashboard, or API route. Here we let a
// request through only if it carries a valid session cookie; otherwise we send
// the visitor to /login (or return 401 for API calls). This is what actually
// protects the revenue data in /api/prospects and /api/sf-metrics.
// ============================================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, tokenIsValid } from "./app/lib/auth";

// The only paths reachable WITHOUT a session, so a locked-out visitor can still
// log in: the login screen and the endpoint that checks the password.
const PUBLIC_PATHS = ["/login", "/api/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (isPublic) return NextResponse.next();

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (tokenIsValid(token)) return NextResponse.next();

  // Not logged in. API calls get a clean 401 (the dashboard's fetch already
  // falls back to its last-good copy on error); everything else — pages and the
  // static HTML dashboards — is redirected to the login screen, remembering
  // where the user was headed so we can send them back after they sign in.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

// Run on every request EXCEPT Next's static assets and the favicon, so CSS/JS
// and images (including the login page's own styling) always load. API routes
// and the static dashboards under public/ are intentionally NOT excluded, so
// they stay behind the gate.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
