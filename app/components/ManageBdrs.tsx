"use client";

import { useState } from "react";
import { MANAGE_BDR_PASSWORD } from "../lib/data";

// A quiet "settings" affordance for editing the BDR roster without touching
// code. It's password-gated — but note that's only a light convenience lock,
// not real security (see the note shown inside the panel).
export default function ManageBdrs({
  bdrs,
  onChange,
}: {
  bdrs: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [newName, setNewName] = useState("");

  function close() {
    setOpen(false);
    setUnlocked(false);
    setPw("");
    setPwError(false);
    setNewName("");
  }

  function tryUnlock() {
    if (pw === MANAGE_BDR_PASSWORD) {
      setUnlocked(true);
      setPwError(false);
      setPw("");
    } else {
      setPwError(true);
    }
  }

  function addBdr() {
    const name = newName.trim();
    if (!name) return;
    // No duplicates (case-insensitive).
    if (bdrs.some((b) => b.toLowerCase() === name.toLowerCase())) {
      setNewName("");
      return;
    }
    onChange([...bdrs, name]);
    setNewName("");
  }

  function removeBdr(name: string) {
    onChange(bdrs.filter((b) => b !== name));
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl border border-black/10 px-3 py-2 text-sm text-neutral-500 transition hover:text-neutral-800 hover:shadow-sm dark:border-white/15 dark:hover:text-neutral-200"
      >
        Manage BDRs
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/15 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-medium">Manage BDRs</h2>
              <button
                onClick={close}
                className="rounded-lg px-2 py-1 text-neutral-400 transition hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                ✕
              </button>
            </div>

            {!unlocked ? (
              <div className="space-y-3">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Enter the password to edit the BDR list.
                </p>
                <input
                  type="password"
                  autoFocus
                  value={pw}
                  onChange={(e) => {
                    setPw(e.target.value);
                    setPwError(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
                  placeholder="Password"
                  className="w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-corgi-ginger/40 dark:border-white/15 dark:bg-white/10"
                />
                {pwError && (
                  <p className="text-sm text-rose-600 dark:text-rose-400">
                    Wrong password — try again.
                  </p>
                )}
                <button
                  onClick={tryUnlock}
                  className="w-full rounded-xl bg-corgi-ginger px-3 py-2 text-sm font-medium text-white transition hover:brightness-105"
                >
                  Unlock
                </button>
                <p className="text-xs leading-relaxed text-neutral-400">
                  Note: this is a light lock to stop accidental edits, not real
                  security.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    Add a BDR
                  </div>
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addBdr()}
                      placeholder="Name"
                      className="flex-1 rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-corgi-ginger/40 dark:border-white/15 dark:bg-white/10"
                    />
                    <button
                      onClick={addBdr}
                      className="rounded-xl bg-corgi-ginger px-4 py-2 text-sm font-medium text-white transition hover:brightness-105"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    Current BDRs ({bdrs.length})
                  </div>
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {bdrs.map((b) => (
                      <div
                        key={b}
                        className="flex items-center justify-between rounded-lg px-3 py-2 text-sm transition hover:bg-black/[0.03] dark:hover:bg-white/5"
                      >
                        <span>{b}</span>
                        <button
                          onClick={() => removeBdr(b)}
                          className="rounded-md px-2 py-0.5 text-xs text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-400"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    {bdrs.length === 0 && (
                      <p className="px-3 py-2 text-sm text-neutral-400">
                        No BDRs yet — add one above.
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-neutral-400">
                  Removing a BDR just takes them off the filter and breakdown —
                  their past deals stay in the data.
                </p>

                <button
                  onClick={close}
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
