import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPage, uuidOr } from "@/lib/workspace/page";
import { getClarification } from "@/lib/workspace/clarifications";
import { Badge } from "@/components/ui/badge";
import { Flash, PageHeader } from "@/components/ui/kit";
import { Thread } from "@/components/workspace/clarifications-view";

export default async function PortalClarification({ params, searchParams }: { params: { id: string }; searchParams: { saved?: string; error?: string } }) {
  if (!uuidOr(params.id)) notFound();
  const { data } = await loadPage(({ db }) => getClarification(db, params.id));
  const c = data.clarification;
  return (
    <div>
      <PageHeader crumb={<Link href="/portal/clarifications" className="hover:underline">Clarifications</Link>} title={`${c.reference} · ${c.subject}`} subtitle={c.engagementName} actions={<Badge tone={c.status === "closed" ? "neutral" : c.status === "answered" ? "positive" : "warning"}>{c.status}</Badge>} />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <Thread clarification={c} messages={data.messages} back={`/portal/clarifications/${c.id}`} />
    </div>
  );
}
