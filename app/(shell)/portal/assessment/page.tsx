import { redirect } from "next/navigation";
import { loadPortal } from "@/lib/workspace/page";

export default async function Page({ searchParams }: { searchParams: { e?: string } }) {
  const { portal } = await loadPortal(searchParams, async () => null);
  const m = portal.current;
  if (!m.assessmentId) redirect(`/portal${portal.q}`);
  redirect(`/organisations/${m.organisationId}/engagements/${m.id}/assessments/${m.assessmentId}`);
}
