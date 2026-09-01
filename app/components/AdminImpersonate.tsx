"use client";

// ============================================================================
// ADMIN "VIEW AS" SWITCHER  (app/components/AdminImpersonate.tsx)
// ----------------------------------------------------------------------------
// Renders nothing unless /api/me says the signed-in user is an admin (see
// app/lib/admins.ts). Lets an admin pick any rep from the roster and view the
// app as if signed in as them — every page reading /api/me's ownerId (a
// future "your own dials" or Career Progression page) then shows that rep's
// data. Selecting "Yourself" clears the impersonation.
//
// The actual security check happens server-side on every /api/me and
// /api/impersonate call (re-verified there, not trusted from anything this
// component holds) — this UI is just a convenience, never the gate.
// ============================================================================

import { useEffect, useState } from "react";

type Me = {
  authenticated: boolean;
  isAdmin?: boolean;
  impersonating?: boolean;
  ownerId?: string | null;
  ownerName?: string | null;
};
type Rep = { id: string; name: string };

export default function AdminImpersonate() {
  const [me, setMe] = useState<Me | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => r.json())
      .then((d: Me) => {
        if (!alive) return;
        setMe(d);
        if (d.isAdmin) {
          fetch("/api/admin/reps")
            .then((r) => r.json())
            .then((d2: { reps?: Rep[] }) => {
              if (alive) setReps(d2.reps ?? []);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!me?.isAdmin) return null;

  async function onChange(ownerId: string) {
    setPending(true);
    try {
      if (!ownerId) {
        await fetch("/api/impersonate", { method: "DELETE" });
      } else {
        await fetch("/api/impersonate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerId }),
        });
      }
      // Reload so every part of the app (not just this component) picks up
      // the new /api/me identity.
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-auto border-t border-black/10 pt-3 dark:border-white/10">
      <label className="px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400 dark:text-neutral-500">
        View as
      </label>
      <select
        value={me.impersonating ? (me.ownerId ?? "") : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-corgi-ginger disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.06] dark:text-neutral-100"
      >
        <option value="">Yourself</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}
