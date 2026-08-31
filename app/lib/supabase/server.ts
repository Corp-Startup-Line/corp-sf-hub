// ============================================================================
// SUPABASE — server client for Route Handlers / Server Components
// (app/lib/supabase/server.ts)
// ----------------------------------------------------------------------------
// Reads/writes the Supabase session cookie via Next's `cookies()` (next/headers).
// Use this in Route Handlers and Server Components — NOT in proxy.ts, which
// gets its cookies from the request/response objects directly instead (see the
// Supabase Next.js proxy/middleware pattern in proxy.ts).
// ============================================================================

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render, where cookies can't be
            // set — harmless as long as a Route Handler or proxy refreshes
            // the session elsewhere (which they do here).
          }
        },
      },
    },
  );
}
