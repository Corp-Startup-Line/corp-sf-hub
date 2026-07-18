"use client";

import { useEffect, useState } from "react";

// The pulsing green dot + "live" wording.
function LiveDot() {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
      <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
      Live
    </span>
  );
}

// Light/dark switch. Adds or removes the `.dark` class on <html> and
// remembers the choice in the browser's localStorage.
function ThemeToggle() {
  const [dark, setDark] = useState(false);

  // On first render, read what the pre-paint script already decided.
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="rounded-full border border-black/10 bg-white/60 px-3 py-2 text-sm backdrop-blur-xl transition hover:bg-white dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/20"
    >
      {dark ? "☀︎ Light" : "☾ Dark"}
    </button>
  );
}

export default function Header() {
  // "Last updated" time. We start as null and fill it in AFTER the page loads
  // in the browser — this avoids a server/browser mismatch error. We also
  // refresh it every 60s to mimic the auto-refresh of the real dashboard.
  const [updated, setUpdated] = useState<string | null>(null);

  useEffect(() => {
    const stamp = () =>
      setUpdated(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    stamp();
    const id = setInterval(stamp, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Corgi Corp London Pipeline
          </h1>
          <LiveDot />
        </div>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Last updated {updated ?? "—"} · live from HubSpot
        </p>
      </div>
      <ThemeToggle />
    </header>
  );
}
