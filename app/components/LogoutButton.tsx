"use client";

import { useState } from "react";

// Signs out of whichever session is active (Google or the shared password)
// and sends the browser back to the login screen. Shared by every page that
// shows a logout control (Header.tsx, the home hub) so they can't drift.
export default function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rounded-full border border-black/10 bg-white/60 px-3 py-2 text-sm backdrop-blur-xl transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/20"
    >
      {loading ? "Logging out…" : "Log out"}
    </button>
  );
}
