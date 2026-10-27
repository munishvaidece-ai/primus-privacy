import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/kit";

export const aiBase = (organisationId: string, engagementId: string) => `/organisations/${organisationId}/engagements/${engagementId}/ai`;

export function withFlag(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

const TABS: Array<{ href: string; label: string }> = [
  { href: "", label: "Overview" },
  { href: "/queue", label: "Needs your review" },
  { href: "/decisions", label: "What the AI did" },
  { href: "/data", label: "Data it reads" },
  { href: "/cases", label: "Operations" },
  { href: "/connectors", label: "Connectors" },
  { href: "/activity", label: "Activity & audit" },
];

export function AiShell({
  organisationId,
  engagementId,
  engagementName,
  active,
  badge,
  children,
}: {
  organisationId: string;
  engagementId: string;
  engagementName: string;
  active: "" | "/queue" | "/decisions" | "/data" | "/cases" | "/connectors" | "/activity";
  badge?: { queue?: number };
  children: ReactNode;
}) {
  const base = aiBase(organisationId, engagementId);
  return (
    <div>
      <PageHeader title="AI Operations Centre" crumb={<Link href={`/organisations/${organisationId}/engagements/${engagementId}`} className="hover:underline">{engagementName}</Link>} />
      <nav aria-label="AI sections" className="-mt-2 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={`${base}${t.href}`}
            aria-current={active === t.href ? "page" : undefined}
            className={
              active === t.href
                ? "rounded-full bg-gradient-to-b from-[#6e211b] to-brand px-4 py-1.5 text-sm font-semibold text-white shadow-[0_8px_18px_-10px_rgba(92,26,22,.85)]"
                : "rounded-full px-4 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 hover:shadow-sm"
            }
          >
            {t.label}
            {t.href === "/queue" && badge?.queue ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{badge.queue}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function Flash({ saved, error }: { saved?: string; error?: string }) {
  return (
    <>
      {saved ? <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{saved === "1" ? "Saved." : saved}</p> : null}
      {error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
    </>
  );
}

export const INPUT = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";
export const LABEL = "block text-xs font-medium text-slate-700";
export const CARD = "rounded-xl border border-slate-200 bg-white shadow-card p-4";
