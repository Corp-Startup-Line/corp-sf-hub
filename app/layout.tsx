import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Corgi Pipeline OS",
  description: "Sales pipeline dashboard (UI shell with sample data)",
};

// Runs before the page paints so we apply the saved light/dark theme
// immediately and avoid a flash of the wrong colours.
const themeScript = `
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
