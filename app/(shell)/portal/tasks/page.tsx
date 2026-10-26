import { loadPortal } from "@/lib/workspace/page";
import { listTasks } from "@/lib/workspace/tasks";
import { PortalHeader } from "@/components/portal/header";
import { Flash } from "@/components/ui/kit";
import { TasksView } from "@/components/workspace/tasks-view";

export default async function PortalTasks({ searchParams }: { searchParams: { e?: string; saved?: string; error?: string } }) {
  const { portal, data } = await loadPortal(searchParams, ({ db, current }) => listTasks(db, { engagementId: current.id }));
  return (
    <div>
      <PortalHeader title="Tasks & milestones" subtitle="Things assigned to your team, and the dates Primus is working to." engagements={portal.engagements} current={portal.current} />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <TasksView tasks={data} engagements={[]} fixedEngagementId={portal.current.id} isClient back={`/portal/tasks${portal.q}`} />
    </div>
  );
}
