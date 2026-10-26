import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { INPUT, LABEL, PageHeader, PhaseBadge } from "@/components/ui/kit";
import type { EngagementMetrics } from "@/lib/workspace/portfolio";

/** Title plus, when the client has more than one engagement, a picker. */
export function PortalHeader({ title, subtitle, engagements, current, actions }: { title: string; subtitle?: ReactNode; engagements: EngagementMetrics[]; current: EngagementMetrics; actions?: ReactNode }) {
  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        crumb={<span>{current.organisationName} · {current.name} <span className="ml-1 align-middle"><PhaseBadge phase={current.phase} /></span></span>}
        actions={actions}
      />
      {engagements.length > 1 ? (
        <form method="get" className="mb-4 flex items-end gap-2">
          <label className={LABEL}>Engagement
            <select name="e" defaultValue={current.id} className={`${INPUT} w-auto min-w-64`}>{engagements.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          </label>
          <Button type="submit" size="sm" variant="secondary">Switch</Button>
        </form>
      ) : null}
    </>
  );
}
