"use client";

// ============================================================================
// LOGIN SCREEN  (app/login/page.tsx)
// ----------------------------------------------------------------------------
// The one page you can reach without a session. Two ways in:
//   1. "Continue with Google" — Supabase OAuth. Only an allowlisted email
//      (app/lib/allowedUsers.ts) actually gets through /auth/callback.
//   2. The shared password — kept as a fallback while the Google rollout is
//      still in progress. Posts to /api/login; on success the server sets the
//      legacy session cookie.
// Either way, on success we send you on to wherever you were headed (the
// `from` query param) — or the home hub.
// ============================================================================

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";

// Only follow a same-app path (must start with a single "/") to avoid an
// open-redirect via a crafted `from` param.
function safeDest(from: string | null): string {
  return from && /^\/(?!\/)/.test(from) ? from : "/";
}

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [notAllowed, setNotAllowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Read ?error=not_allowed in an effect (not during render) so this never
  // runs during server rendering — same hydration-safety pattern used
  // elsewhere in this app (see Header.tsx).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "not_allowed") setNotAllowed(true);
  }, []);

  async function onGoogleSignIn() {
    if (googleLoading) return;
    setGoogleLoading(true);
    setNotAllowed(false);
    const from = new URLSearchParams(window.location.search).get("from");
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?from=${encodeURIComponent(safeDest(from))}`,
      },
    });
    // On success the browser navigates away to Google immediately; we only
    // get here (and need to stop the spinner) if that kickoff itself failed.
    if (oauthError) setGoogleLoading(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const from = new URLSearchParams(window.location.search).get("from");
        window.location.href = safeDest(from);
        return;
      }
      setError(true);
      setPassword("");
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-corgi-ginger/10 text-corgi-ginger">
            <svg
              viewBox="0 0 24 24"
              width={26}
              height={26}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            Corp SF Hub
          </h1>
          <p className="mt-1.5 text-[13px] text-neutral-500 dark:text-neutral-400">
            Sign in to continue
          </p>
        </div>

        <div className="rounded-3xl border border-white/50 bg-gradient-to-b from-white/70 to-white/35 p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-14px_rgba(0,0,0,0.22)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.12] dark:from-white/[0.10] dark:to-white/[0.03] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_12px_34px_-14px_rgba(0,0,0,0.55)]">
          <button
            type="button"
            onClick={onGoogleSignIn}
            disabled={googleLoading}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-[15px] font-medium text-neutral-800 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.06] dark:text-neutral-100 dark:hover:bg-white/[0.1]"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
              />
              <path
                fill="#FBBC05"
                d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33Z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
              />
            </svg>
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </button>

          {notAllowed && (
            <p className="mt-3 text-[13px] text-red-500">
              This Google account isn&apos;t authorized for Corp SF Hub. Ask
              an admin to add it.
            </p>
          )}

          <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500">
            <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
            or use the password
            <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
          </div>

          <form onSubmit={onSubmit}>
            <label
              htmlFor="password"
              className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(false);
              }}
              aria-invalid={error}
              className={`mt-2 w-full rounded-2xl border bg-white/60 px-4 py-3 text-[15px] outline-none transition-colors placeholder:text-neutral-400 focus:border-corgi-ginger focus:ring-2 focus:ring-corgi-ginger/25 dark:bg-white/[0.06] ${
                error
                  ? "border-red-400/70"
                  : "border-black/10 dark:border-white/15"
              }`}
              placeholder="••••••••"
            />

            {error && (
              <p className="mt-2 text-[13px] text-red-500">
                Incorrect password. Try again.
              </p>
            )}

            <button
              type="submit"
              disabled={loading || password.length === 0}
              className="mt-5 flex w-full items-center justify-center rounded-full bg-corgi-ginger px-4 py-3 text-[15px] font-medium text-white transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Checking…" : "Enter"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
