// Turns a "2026-03" string into "March 2026" for display.
export function prettyMonth(m: string): string {
  const [year, month] = m.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
