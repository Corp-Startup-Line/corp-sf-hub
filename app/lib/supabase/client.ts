// ============================================================================
// SUPABASE — browser client (app/lib/supabase/client.ts)
// ----------------------------------------------------------------------------
// Used ONLY in client components (e.g. the login page) to kick off the Google
// OAuth flow. Safe to use in the browser: the URL + anon key are public by
// design (Supabase enforces access via Row Level Security / Auth, not by
// keeping this key secret).
// ============================================================================

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
