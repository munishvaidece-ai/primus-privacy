import { redirect } from "next/navigation";
import { loadPortal } from "@/lib/workspace/page";

// The record itself lives on the shared organisation screen; this entry point
// only takes the client to it.
export default async function Page({ searchParams }: { searchParams: { e?: string } }) {
  const { portal } = await loadPortal(searchParams, async () => null);
  redirect(`/organisations/${portal.current.organisationId}/master-data/business-units`);
}
