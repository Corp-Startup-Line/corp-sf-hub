"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AdminImpersonate from "./AdminImpersonate";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/career-progression", label: "Career Progression" },
];

export default function Sidebar() {
  const pathname = usePathname();

  // No sidebar on the login screen — nothing to navigate to yet.
  if (pathname === "/login") return null;

  return (
    <nav className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-1 border-r border-black/10 bg-white/60 px-3 py-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
      <div className="mb-4 flex items-center gap-2 px-3">
        <span className="h-2.5 w-5 rounded-sm bg-corgi-ginger" />
        <span className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          Corgi
        </span>
      </div>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              "rounded-xl px-3 py-2 text-sm font-medium transition " +
              (active
                ? "bg-corgi-ginger/15 text-corgi-ginger"
                : "text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-neutral-50")
            }
          >
            {item.label}
          </Link>
        );
      })}
      <AdminImpersonate />
    </nav>
  );
}
