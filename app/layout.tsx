import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "PRIMUS PRIVACY",
  description: "PRIMUS PRIVACY — DPDP advisory and continuous compliance platform.",
};

// Root layout — shared by both /login and the authenticated shell
// (app/(shell)/layout.tsx). No authentication check happens here; the
// shell layout is where protected routes actually enforce it (PHASE A
// instructions §5/§8), so this file stays a plain, unauthenticated shell
// every route (including /login) can render inside.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
