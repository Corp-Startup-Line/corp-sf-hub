// ============================================================================
// PROXY — the site-wide auth gate (proxy.ts)
// ----------------------------------------------------------------------------
// In Next.js 16 this file used to be called "middleware". It runs on the server
// BEFORE every request reaches a page, dashboard, or API route. A request gets
// through if EITHER:
//   1. it carries a valid Google (Supabase) session for an allowlisted email, or
//   2. it carries the legacy shared-password session cookie (kept as a fallback
//      while the Google rollout is still in progress).
// Otherwise we send the visitor to /login (or return 401 for API calls). This
// is what actually protects the revenue data in /api/prospects and /api/sf-metrics.
// ============================================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE, tokenIsValid } from "./app/lib/auth";
import { isAllowedEmail } from "./app/lib/allowedUsers";

// The only paths reachable WITHOUT a session, so a locked-out visitor can still
// log in: the login screen, the legacy password check, and the Google OAuth
// callback (which is where a session first gets created).
const PUBLIC_PATHS = ["/login", "/api/login", "/auth/callback"];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (isPublic) return NextResponse.next();

  // 1. Legacy shared-password session (fallback path).
  const legacyToken = request.cookies.get(AUTH_COOKIE)?.value;
  if (tokenIsValid(legacyToken)) return NextResponse.next();

  // 2. Google (Supabase) session, only if Supabase is actually configured —
  // otherwise this behaves exactly as before (password-only), same
  // graceful-degrade pattern as app/lib/quoteStore.ts / metricsStore.ts.
  if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
    let response = NextResponse.next({ request });
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          // Re-apply refreshed cookies to both the request (so this same
          // proxy invocation sees them) and a fresh response (so the browser
          // actually receives the Set-Cookie headers).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && isAllowedEmail(user.email)) return response;
  }

  // Not logged in (or logged in with a Google account that isn't allowlisted).
  // API calls get a clean 401 (the dashboard's fetch already falls back to its
  // last-good copy on error); everything else — pages and the static HTML
  // dashboards — is redirected to the login screen, remembering where the user
  // was headed so we can send them back after they sign in.
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
