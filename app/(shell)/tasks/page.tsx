import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { listTasks } from "@/lib/workspace/tasks";
import { engagementMetrics } from "@/lib/workspace/portfolio";
import { Flash, PageHeader } from "@/components/ui/kit";
import { TasksView } from "@/components/workspace/tasks-view";

export default async function TasksPage({ searchParams }: { searchParams: { saved?: string; error?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => {
    if (viewer.isClient) return null;
    return { tasks: await listTasks(db), engagements: await engagementMetrics(db) };
  });
  if (viewer.isClient || !data) redirect("/portal/tasks");
  return (
    <div>
      <PageHeader title="Tasks & milestones" subtitle="Work for you and for your clients across every engagement. Milestones are shown to the client as the engagement timeline." />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <TasksView tasks={data.tasks} engagements={data.engagements.filter((e) => e.status !== "closed").map((e) => ({ id: e.id, label: `${e.organisationName} · ${e.name}` }))} isClient={false} back="/tasks" />
    </div>
  );
}
