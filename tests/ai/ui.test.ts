// Drives the real screens and their form handlers (server actions) against
// real PostgreSQL: pages are rendered to HTML, forms are submitted as
// FormData, the worker runs in between. Only sign-in (Supabase) and
// Next's redirect / cache plumbing are replaced.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ userId: "" }));
class Redirect extends Error { constructor(public url: string) { super(`REDIRECT ${url}`); } }
class NotFound extends Error { constructor() { super("NOT_FOUND"); } }
vi.mock("@/lib/auth/session", () => ({ requireAuthenticatedUser: async () => ({ id: state.userId, email: "t@example.com" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Redirect(u); }, notFound: () => { throw new NotFound(); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { runOnce } from "@/lib/ai/worker";
import { buildAiFixture, type AiFixture } from "./helpers";
import AiOverviewPage from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/page";
import QueuePage from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/queue/page";
import ActivityPage from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/activity/page";
import ConnectorsPage from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/connectors/page";
import CasesPage from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/cases/page";
import CaseDetailPage from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/cases/[caseId]/page";
import CatalogPage from "@/app/(shell)/connectors/page";
import { saveAiSettingsAction, pauseAiAction, resumeAiAction, runNowAction } from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/actions";
import { decideSuggestionAction } from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/queue/actions";
import { addConnectorAction, runConnectorAction } from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/connectors/actions";
import { approveResponseAction, createCaseAction } from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/ai/cases/actions";
import { GET as health } from "@/app/api/health/route";

const form = (o: Record<string, string | string[] | boolean>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) {
    if (v === true) f.set(k, "on");
    else if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else if (v !== false) f.set(k, v);
  }
  return f;
};
async function submit(action: (f: FormData) => Promise<void>, f: FormData): Promise<string> {
  try { await action(f); } catch (e) { if (e instanceof Redirect) return decodeURIComponent(e.url); throw e; }
  throw new Error("action did not redirect");
}
async function html(page: (p: never) => Promise<unknown>, props: unknown): Promise<string> {
  return renderToStaticMarkup((await page(props as never)) as never);
}
async function drain() { let n = 0; while (n < 40 && (await runOnce("ui-worker", () => {}))) n++; }

describe("screens and forms", () => {
  let f: AiFixture, root: string;
  const params = () => ({ organisationId: f.organisationId, engagementId: f.engagementId });
  const hidden = () => ({ organisationId: f.organisationId, engagementId: f.engagementId });

  beforeAll(async () => {
    f = await buildAiFixture("UI");
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ui-root-")));
    fs.writeFileSync(path.join(root, "staff.csv"), "name,email\nAsha,asha.rao@clientco.in\n");
    process.env.CONNECTOR_FOLDER_ROOTS = root;
    process.env.CONNECTOR_SECRET_KEY = Buffer.alloc(32, 3).toString("base64");
  });

  it("the overview starts switched off and a manager switches it on with the gates", async () => {
    state.userId = f.emId;
    // Before the AI has ever been enabled the agent cannot have been given access; saving enables it.
    const off = await html(AiOverviewPage, { params: params(), searchParams: {} });
    expect(off).toContain("AI is switched off");
    const url = await submit(saveAiSettingsAction, form({ ...hidden(), enabled: true, level: "3", thresholdSupervised: "90", thresholdFull: "75", gateRejectCriticalEvidence: true, gateReleaseCriticalFindings: true, gateIssueFinalReport: true, gateSendBreachNotices: true }));
    expect(url).toContain("saved=");
    const on = await html(AiOverviewPage, { params: params(), searchParams: {} });
    expect(on).toContain("AI is on — Full autopilot");
    expect(on).toContain("Where your data goes");
    expect(on).toContain("built-in rules engine");
    expect(on).toContain("Sign-off gates");
    expect(on).toContain("Pause everything");
  });

  it("a consultant sees the overview but not the settings; an outsider gets 'not found'", async () => {
    state.userId = f.consultantId;
    const v = await html(AiOverviewPage, { params: params(), searchParams: {} });
    expect(v).toContain("AI is on");
    expect(v).not.toContain("Save settings");
    const other = await buildAiFixture("UIOther");
    state.userId = other.emId;
    await expect(html(AiOverviewPage, { params: params(), searchParams: {} })).rejects.toThrow("NOT_FOUND");
    await expect(html(QueuePage, { params: params(), searchParams: {} })).rejects.toThrow("NOT_FOUND");
    await expect(submit(saveAiSettingsAction, form({ ...hidden(), enabled: true, level: "1", thresholdSupervised: "90", thresholdFull: "75" }))).resolves.toContain("error=");
  });

  it("pause is one click, and resume brings it back", async () => {
    state.userId = f.emId;
    expect(await submit(pauseAiAction, form(hidden()))).toContain("paused");
    expect(await html(AiOverviewPage, { params: params(), searchParams: {} })).toContain("AI is paused");
    state.userId = f.consultantId; // a consultant cannot resume
    expect(await submit(resumeAiAction, form(hidden()))).toContain("error=");
    state.userId = f.emId;
    expect(await submit(resumeAiAction, form(hidden()))).toContain("running again");
    expect(await submit(runNowAction, form(hidden()))).toContain("saved=");
  });

  it("connectors: add a folder, test, scan, and see what was found — without the data", async () => {
    state.userId = f.emId;
    expect(await submit(addConnectorAction, form({ ...hidden(), type: "document_folder", name: "HR share", c_path: root }))).toContain("saved=");
    expect(await submit(addConnectorAction, form({ ...hidden(), type: "document_folder", name: "Bad", c_path: "" }))).toContain("Folder path is required");
    expect(await submit(addConnectorAction, form({ ...hidden(), type: "sharepoint_onedrive", name: "SP" }))).toContain("roadmap");
    const page0 = await html(ConnectorsPage, { params: params(), searchParams: {} });
    expect(page0).toContain("HR share");
    expect(page0).toContain("Not tested yet");
    const cid = /name="connectorId" value="([0-9a-f-]{36})"/.exec(page0)![1]!;
    await submit(runConnectorAction, form({ ...hidden(), connectorId: cid, kind: "test" }));
    await submit(runConnectorAction, form({ ...hidden(), connectorId: cid, kind: "scan" }));
    await drain();
    const page1 = await html(ConnectorsPage, { params: params(), searchParams: {} });
    expect(page1).toContain("Working");
    expect(page1).toContain("staff.csv");
    expect(page1).toContain("email");
    expect(page1).not.toContain("asha.rao@clientco.in");
  });

  it("a breach: open it, the notice waits at the gate, a consultant cannot decide, the manager approves", async () => {
    state.userId = f.consultantId;
    const when = "2026-10-20T08:00";
    const created = await submit(createCaseAction, form({ ...hidden(), type: "breach", title: "Wrong recipient", discoveredAt: when, categories: ["contact", "financial"], principalsAffected: "40", description: "File emailed to the wrong person." }));
    expect(created).toContain("saved=");
    await drain();

    const q = await html(QueuePage, { params: params(), searchParams: {} });
    expect(q).toContain("Sign-off gate: Send breach notices");
    expect(q).toContain("waiting for an Engagement Manager"); // consultant has no buttons on gated items
    const gatedCard = /Sign-off gate: Send breach notices[\s\S]*?<\/li>/.exec(q)![0];
    expect(gatedCard).not.toContain("suggestionId"); // no approve / reject form on the gated item for a consultant

    state.userId = f.emId;
    const qm = await html(QueuePage, { params: params(), searchParams: {} });
    expect(qm).toContain("Notice to the Data Protection Board");
    const gatedId = /Sign-off gate: Send breach notices[\s\S]*?name="suggestionId" value="([0-9a-f-]{36})"/.exec(qm)![1]!;
    expect(await submit(decideSuggestionAction, form({ ...hidden(), suggestionId: gatedId, action: "approve" }))).toContain("Approved");
    // Rejecting needs a reason.
    const next = /name="suggestionId" value="([0-9a-f-]{36})"/.exec(await html(QueuePage, { params: params(), searchParams: {} }));
    if (next) expect(await submit(decideSuggestionAction, form({ ...hidden(), suggestionId: next[1]!, action: "reject" }))).toContain("reason");

    const list = await html(CasesPage, { params: params(), searchParams: {} });
    const caseId = /cases\/([0-9a-f-]{36})/.exec(list)![1]!;
    expect(list).toContain("BR-2026-0001");
    const detail = await html(CaseDetailPage, { params: { ...params(), caseId }, searchParams: {} });
    expect(detail).toContain("BOARD NOTICE");
    expect(detail).toContain("Approved");
    // Approving again is refused cleanly.
    expect(await submit(approveResponseAction, form({ ...hidden(), caseId }))).toContain("already approved");
  });

  it("activity page lists who did what", async () => {
    state.userId = f.emId;
    const a = await html(ActivityPage, { params: params(), searchParams: {} });
    expect(a).toContain("Audit trail");
    expect(a).toContain("Settings changed");
    expect(a).toContain("Scanned");
  });

  it("the portal-wide catalogue lists every connector and labels planned ones honestly", async () => {
    state.userId = f.emId;
    const c = await html(CatalogPage, {});
    expect(c).toContain("Website privacy &amp; consent scan");
    expect(c).toContain("SharePoint / OneDrive");
    expect(c).toContain("Planned");
    expect(c).toContain("Available now");
    expect(c).toContain("Not built yet");
  });

  it.runIf(!!process.env.DUMP_HTML)("dump pages for a visual check", async () => {
    state.userId = f.emId;
    const dir = process.env.DUMP_HTML!;
    fs.mkdirSync(dir, { recursive: true });
    const list = await html(CasesPage, { params: params(), searchParams: {} });
    const caseId = /cases\/([0-9a-f-]{36})/.exec(list)![1]!;
    const pages: Record<string, string> = {
      overview: await html(AiOverviewPage, { params: params(), searchParams: {} }),
      queue: await html(QueuePage, { params: params(), searchParams: {} }),
      connectors: await html(ConnectorsPage, { params: params(), searchParams: {} }),
      cases: list,
      case: await html(CaseDetailPage, { params: { ...params(), caseId }, searchParams: {} }),
      activity: await html(ActivityPage, { params: params(), searchParams: {} }),
      catalogue: await html(CatalogPage, {}),
    };
    for (const [k, v] of Object.entries(pages)) fs.writeFileSync(path.join(dir, `${k}.html`), v);
  });

  it("health probe", async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_SUPERUSER_URL;
    const r = await health();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    delete process.env.DATABASE_URL;
    expect((await health()).status).toBe(503);
  });
});
void createElement;
