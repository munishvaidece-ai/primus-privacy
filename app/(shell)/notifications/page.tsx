import Link from "next/link";
import { loadPage } from "@/lib/workspace/page";
import { listNotifications } from "@/lib/workspace/notifications";
import { Button } from "@/components/ui/button";
import { Empty, Flash, PageHeader, fmtDateTime } from "@/components/ui/kit";
import { markAllReadAction, markReadAction } from "../workspace-actions";

export default async function NotificationsPage({ searchParams }: { searchParams: { saved?: string; error?: string } }) {
  const { data } = await loadPage(({ db, user }) => listNotifications(db, user.id, { limit: 200 }));
  const unread = data.filter((n) => !n.readAt).length;
  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Things that happened on your engagements. These are shown here only; the platform does not send email."
        actions={unread > 0 ? (
          <form action={markAllReadAction}><input type="hidden" name="back" value="/notifications" /><Button type="submit" variant="secondary" size="sm">Mark all {unread} as read</Button></form>
        ) : null}
      />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      {data.length === 0 ? <Empty>You have no notifications.</Empty> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-card">
          {data.map((n) => (
            <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${n.readAt ? "" : "bg-blue-50/50"}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {!n.readAt ? <span className="mr-2 inline-block rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold uppercase text-white">New</span> : null}
                  {n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}
                </p>
                {n.body ? <p className="mt-0.5 text-sm text-slate-600">{n.body}</p> : null}
                <p className="mt-0.5 text-xs text-slate-500">{fmtDateTime(n.createdAt)}</p>
              </div>
              {!n.readAt ? (
                <form action={markReadAction}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="back" value="/notifications" /><Button type="submit" variant="ghost" size="sm">Mark read</Button></form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
