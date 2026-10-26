import { PageHeader } from "@/components/ui/kit";

export default function NoEngagementPage() {
  return (
    <div>
      <PageHeader title="Your portal" />
      <p className="max-w-xl rounded-md border border-dashed border-slate-300 px-6 py-10 text-sm text-slate-600">
        You are signed in, but you have not been added to an engagement yet. Your Primus contact will add you; once they do, your tasks, questionnaire and results appear here.
      </p>
    </div>
  );
}
