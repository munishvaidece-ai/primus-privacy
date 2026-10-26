import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Primus Privacy",
  description: "Primus Privacy — DPDP advisory and continuous compliance platform.",
};

// Root layout — shared by both /login and the authenticated shell
// (app/(shell)/layout.tsx). No authentication check happens here; the
// shell layout is where protected routes actually enforce it.
// Fonts come from Google Fonts (the same two families as the microsite);
// offline, the system sans-serif is used instead and nothing breaks.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Fira+Sans:wght@500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
