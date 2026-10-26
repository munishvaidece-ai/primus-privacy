import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadPage, uuidOr } from "@/lib/workspace/page";
import { getClarification } from "@/lib/workspace/clarifications";
import { Badge } from "@/components/ui/badge";
import { Flash, PageHeader } from "@/components/ui/kit";
import { Thread } from "@/components/workspace/clarifications-view";

export default async function ClarificationPage({ params, searchParams }: { params: { id: string }; searchParams: { saved?: string; error?: string } }) {
  if (!uuidOr(params.id)) notFound();
  const { viewer, data } = await loadPage(({ db }) => getClarification(db, params.id));
  if (viewer.isClient) redirect(`/portal/clarifications/${params.id}`);
  const c = data.clarification;
  return (
    <div>
      <PageHeader crumb={<Link href="/clarifications" className="hover:underline">Clarifications</Link>} title={`${c.reference} · ${c.subject}`} subtitle={`${c.organisationName} · ${c.engagementName}`} actions={<Badge tone={c.status === "closed" ? "neutral" : c.status === "answered" ? "positive" : "warning"}>{c.status}</Badge>} />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <Thread clarification={c} messages={data.messages} back={`/clarifications/${c.id}`} />
    </div>
  );
}
