"use client";

// ============================================================================
// LOGIN SCREEN  (app/login/page.tsx)
// ----------------------------------------------------------------------------
// The one page you can reach without a password. It posts the password to
// /api/login; on success the server sets the session cookie and we send you on
// to wherever you were headed (the `from` query param) — or the home hub.
// ============================================================================

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

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
        // Send the user back where they came from, but only to a safe in-app
        // path (must start with a single "/") to avoid an open-redirect.
        const from = new URLSearchParams(window.location.search).get("from");
        const dest = from && /^\/(?!\/)/.test(from) ? from : "/";
        window.location.href = dest;
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
            Enter the password to continue
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-3xl border border-white/50 bg-gradient-to-b from-white/70 to-white/35 p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-14px_rgba(0,0,0,0.22)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.12] dark:from-white/[0.10] dark:to-white/[0.03] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_12px_34px_-14px_rgba(0,0,0,0.55)]"
        >
          <label
            htmlFor="password"
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoFocus
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
    </main>
  );
}
