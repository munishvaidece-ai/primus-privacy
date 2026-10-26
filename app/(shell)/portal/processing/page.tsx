import { redirect } from "next/navigation";
import { loadPortal } from "@/lib/workspace/page";

export default async function Page({ searchParams }: { searchParams: { e?: string } }) {
  const { portal } = await loadPortal(searchParams, async () => null);
  redirect(`/organisations/${portal.current.organisationId}/engagements/${portal.current.id}/data-landscape`);
}
