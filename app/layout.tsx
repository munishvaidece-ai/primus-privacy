import type { ReactNode } from "react";

export const metadata = {
  title: "PRIMUS PRIVACY",
  description:
    "PRIMUS PRIVACY — architecture and database-foundation phase. No product UI has been built yet.",
};

// Minimal root layout — required for a valid Next.js App Router project.
// This is NOT product UI. Milestone 1 is database-only; see PROGRESS.md.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
