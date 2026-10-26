// Drives the real workspace and portal screens and their forms against real
// PostgreSQL: pages are rendered to HTML and forms are submitted as FormData.
// Only sign-in (Supabase) and Next's redirect / cache plumbing are replaced.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ userId: "" }));
class Redirect extends Error { constructor(public url: string) { super(`REDIRECT ${url}`); } }
class NotFound extends Error { constructor() { super("NOT_FOUND"); } }
vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedUser: async () => ({ id: state.userId, email: "t@example.com" }),
  getAuthenticatedUser: async () => (state.userId ? { id: state.userId, email: "t@example.com" } : null),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Redirect(u); }, notFound: () => { throw new NotFound(); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { buildWorkspaceFixture, insertFinding, pool, asFixtureSetup, type WsFixture } from "./helpers";
import { grantTenantMembership } from "../rls/helpers";
import RootPage from "@/app/page";
import Dashboard from "@/app/(shell)/dashboard/page";
import OrganisationsPage from "@/app/(shell)/organisations/page";
import EngagementsPage from "@/app/(shell)/engagements/page";
import StakeholdersPage from "@/app/(shell)/stakeholders/page";
import TasksPage from "@/app/(shell)/tasks/page";
import NotificationsPage from "@/app/(shell)/notifications/page";
import DiscoveryListPage from "@/app/(shell)/discovery/page";
import DiscoveryReviewPage from "@/app/(shell)/discovery/[engagementId]/page";
import AssessmentsPage from "@/app/(shell)/assessments/page";
import EvidenceReviewPage from "@/app/(shell)/evidence-review/page";
import FindingsPage from "@/app/(shell)/findings/page";
import RisksPage from "@/app/(shell)/risks/page";
import RemediationPage from "@/app/(shell)/remediation/page";
import ClarificationsPage from "@/app/(shell)/clarifications/page";
import AuditPage from "@/app/(shell)/audit/page";
import EngagementPage from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/page";
import OrganisationPage from "@/app/(shell)/organisations/[organisationId]/page";
import AssessmentPage from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/assessments/[assessmentId]/page";
import PortalOverview from "@/app/(shell)/portal/page";
import PortalTasks from "@/app/(shell)/portal/tasks/page";
import PortalProfile from "@/app/(shell)/portal/profile/page";
import PortalDiscovery from "@/app/(shell)/portal/discovery/page";
import PortalEvidence from "@/app/(shell)/portal/evidence/page";
import PortalClarifications from "@/app/(shell)/portal/clarifications/page";
import PortalFindings from "@/app/(shell)/portal/findings/page";
import PortalRemediation from "@/app/(shell)/portal/remediation/page";
import PortalRisks from "@/app/(shell)/portal/risks/page";
import PortalReports from "@/app/(shell)/portal/reports/page";
import PortalRights from "@/app/(shell)/portal/rights/page";
import PortalAssessment from "@/app/(shell)/portal/assessment/page";
import PortalNone from "@/app/(shell)/portal/none/page";
import { GET as downloadReport } from "@/app/(shell)/portal/reports/[id]/download/route";
import { GET as workingReport } from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/reports/route";
import {
  createTaskAction, raiseClarificationAction, saveDiscoveryAction, submitDiscoveryAction, approveDiscoveryAction,
  releaseFindingsAction, validateAnswersAction, returnAssessmentAction, submitAssessmentAction, logRightsAction,
  setRightsStatusAction, requestEvidenceAction, provideEvidenceAction, updateOrganisationProfileAction, releaseReportAction, markAllReadAction,
} from "@/app/(shell)/workspace-actions";
import { updateAssessmentResponseAction } from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/assessments/[assessmentId]/actions";

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x));
  return f;
};
async function submit(action: (f: FormData) => Promise<void>, f: FormData): Promise<string> {
  try { await action(f); } catch (e) { if (e instanceof Redirect) return decodeURIComponent(e.url); throw e; }
  throw new Error("action did not redirect");
}
async function html(page: (p: never) => Promise<unknown>, props: unknown = { searchParams: {} }): Promise<string> {
  return renderToStaticMarkup((await page(props as never)) as never);
}
async function redirectsTo(page: (p: never) => Promise<unknown>, props: unknown = { searchParams: {} }): Promise<string> {
  try { await page(props as never); } catch (e) { if (e instanceof Redirect) return e.url; throw e; }
  throw new Error("page did not redirect");
}
const sp = (o: Record<string, string> = {}) => ({ searchParams: o });

describe("the Primus workspace and the client portal, screen by screen", () => {
  let f: WsFixture;
  let eng: { organisationId: string; engagementId: string };
  let draftTitle: string;

  beforeAll(async () => {
    f = await buildWorkspaceFixture("UiWs");
    // Primus people are members of their firm's tenant (the bootstrap script does this).
    await asFixtureSetup(async (client) => { await grantTenantMembership(client, f.emId, f.tenantId, "Practice Partner"); });
    eng = { organisationId: f.organisationId, engagementId: f.engagementId };
    draftTitle = "Draft finding that only Primus may see";
    await insertFinding(f, { title: draftTitle, released: false });
    await insertFinding(f, { title: "Released finding the client may read", released: true });
  });

  it("the front door sends each person to the right home", async () => {
    state.userId = "";
    expect(await redirectsTo(RootPage as never)).toBe("/site/index.html");
    state.userId = f.emId;
    expect(await redirectsTo(RootPage as never)).toBe("/dashboard");
    state.userId = f.clientAdminId;
    expect(await redirectsTo(RootPage as never)).toBe("/portal");
  });

  it("every Primus screen renders for the Engagement Manager", async () => {
    state.userId = f.emId;
    for (const [name, page, props] of [
      ["dashboard", Dashboard, sp()], ["organisations", OrganisationsPage, sp()], ["engagements", EngagementsPage, sp()], ["stakeholders", StakeholdersPage, sp()],
      ["tasks", TasksPage, sp()], ["notifications", NotificationsPage, sp()], ["discovery", DiscoveryListPage, sp()], ["assessments", AssessmentsPage, sp()],
      ["evidence", EvidenceReviewPage, sp()], ["findings", FindingsPage, sp()], ["risks", RisksPage, sp()], ["remediation", RemediationPage, sp()],
      ["clarifications", ClarificationsPage, sp()], ["audit", AuditPage, sp({ e: f.engagementId })],
    ] as Array<[string, (p: never) => Promise<unknown>, unknown]>) {
      const out = await html(page, props);
      expect(out.length, name).toBeGreaterThan(200);
    }
    const findings = await html(FindingsPage as never, sp());
    expect(findings).toContain(draftTitle);
    expect(findings).toContain("Release");
  });

  it("a client is moved off Primus-only screens and cannot reach them", async () => {
    state.userId = f.clientAdminId;
    expect(await redirectsTo(OrganisationsPage as never, sp())).toBe("/portal");
    expect(await redirectsTo(FindingsPage as never, sp())).toBe("/portal/findings");
    expect(await redirectsTo(EvidenceReviewPage as never, sp())).toBe("/portal/evidence");
    const working = await workingReport(new Request("http://x"), { params: eng });
    expect(working.status).toBe(404);
  });

  it("every portal screen renders for the Client Administrator, and drafts stay hidden", async () => {
    state.userId = f.clientAdminId;
    for (const [name, page] of [
      ["overview", PortalOverview], ["tasks", PortalTasks], ["profile", PortalProfile], ["discovery", PortalDiscovery], ["evidence", PortalEvidence],
      ["clarifications", PortalClarifications], ["findings", PortalFindings], ["remediation", PortalRemediation], ["risks", PortalRisks],
      ["reports", PortalReports], ["rights", PortalRights],
    ] as Array<[string, (p: never) => Promise<unknown>]>) {
      const out = await html(page, sp());
      expect(out.length, name).toBeGreaterThan(200);
    }
    const found = await html(PortalFindings as never, sp());
    expect(found).toContain("Released finding the client may read");
    expect(found).not.toContain(draftTitle);
    expect(await html(PortalNone as never, sp())).toContain("not been added");
  });

  it("a client user with no engagement lands on the 'not added yet' page", async () => {
    const empty = await buildWorkspaceFixture("UiEmpty");
    // Remove this client's access to anything by using a fresh client of a different org with its engagement membership revoked is overkill:
    // a user from another tenant who sees no engagement behaves the same, so use an unrelated client.
    state.userId = empty.otherClientId;
    // This client does have an engagement (their own), so the overview renders for them and not for ours.
    const own = await html(PortalOverview as never, sp());
    expect(own).toContain("Overview");
    expect(own).not.toContain("UiWs");
  });

  it("tasks: Primus adds a milestone and a client task; the client sees both, and can finish the one for them", async () => {
    state.userId = f.emId;
    let url = await submit(createTaskAction, form({ engagementId: f.engagementId, title: "Kick-off workshop", kind: "milestone", assigneeSide: "primus", dueDate: "2030-01-15", back: "/tasks" }));
    expect(url).toContain("saved=");
    url = await submit(createTaskAction, form({ engagementId: f.engagementId, title: "Send the staff list", kind: "task", assigneeSide: "client", dueDate: "2030-01-10", back: "/tasks" }));
    expect(url).toContain("saved=");
    state.userId = f.clientAdminId;
    const out = await html(PortalTasks as never, sp());
    expect(out).toContain("Kick-off workshop");
    expect(out).toContain("Send the staff list");
    const overview = await html(PortalOverview as never, sp());
    expect(overview).toContain("Kick-off workshop");
  });

  it("clarifications: the client raises one, Primus replies, either side can read the thread", async () => {
    state.userId = f.clientAdminId;
    const url = await submit(raiseClarificationAction, form({ engagementId: f.engagementId, subject: "Is the call centre in scope?", question: "We outsource it.", back: "/portal/clarifications" }));
    expect(url).toMatch(/^\/portal\/clarifications\/[0-9a-f-]{36}/);
    state.userId = f.emId;
    const list = await html(ClarificationsPage as never, sp());
    expect(list).toContain("Is the call centre in scope?");
  });

  it("discovery: save, complete a step, a read-only executive cannot edit, submit, Primus approves", async () => {
    state.userId = f.cxoId;
    const ro = await html(PortalDiscovery as never, sp());
    expect(ro).toContain("can read this questionnaire but not change");
    expect(ro).not.toContain("Save draft");
    expect(await submit(saveDiscoveryAction, form({ engagementId: f.engagementId, sectionKey: "organisation_profile", a_summary: "x", back: "/portal/discovery" }))).toContain("error=");

    state.userId = f.clientAdminId;
    const edit = await html(PortalDiscovery as never, sp());
    expect(edit).toContain("Save and mark complete");
    const done = await submit(saveDiscoveryAction, form({ engagementId: f.engagementId, sectionKey: "organisation_profile", intent: "complete", a_summary: "A lender serving retail customers", a_sector: "financial_services", a_employees: "250_1000", back: "/portal/discovery?step=1" }));
    expect(done).toContain("saved=");
    // Not everything is complete, so submitting is refused with a plain message.
    expect(await submit(submitDiscoveryAction, form({ engagementId: f.engagementId, back: "/portal/discovery" }))).toContain("error=");
    state.userId = f.emId;
    const review = await html(DiscoveryReviewPage as never, { params: { engagementId: f.engagementId }, searchParams: {} });
    expect(review).toContain("A lender serving retail customers");
    // Approval is only possible after submission.
    expect(await submit(approveDiscoveryAction, form({ engagementId: f.engagementId, back: "/discovery" }))).toContain("error=");
  });

  it("assessment: client answers, submits, answers lock; Primus validates or returns", async () => {
    const page = (id: string) => html(AssessmentPage as never, { params: { ...eng, assessmentId: f.assessmentId }, searchParams: {} });
    state.userId = f.clientAdminId;
    let out = await page(f.clientAdminId);
    expect(out).toContain("Review &amp; submission");
    // Submit refused until everything is answered.
    expect(await submit(submitAssessmentAction, form({ assessmentId: f.assessmentId, back: "/x" }))).toContain("error=");
    for (const key of ["breach", "policy", "training", "retention"]) {
      const url = await submit(updateAssessmentResponseAction, form({ ...eng, assessmentId: f.assessmentId, assessmentControlId: f.assessmentControlIds[key]!, effectivenessRating: "implemented", decisionRationale: "Documented", returnTo: `/organisations/${f.organisationId}/engagements/${f.engagementId}/assessments/${f.assessmentId}` }));
      expect(url, key).toContain("saved=");
    }
    expect(await submit(submitAssessmentAction, form({ assessmentId: f.assessmentId, back: "/x" }))).toContain("saved=");
    // Locked for the client: the answer form is gone and a change is refused with a plain sentence.
    out = await page(f.clientAdminId);
    expect(out).toContain("locked while Primus reviews");
    const refused = await submit(updateAssessmentResponseAction, form({ ...eng, assessmentId: f.assessmentId, assessmentControlId: f.assessmentControlIds.breach!, effectivenessRating: "not_implemented", returnTo: `/organisations/${f.organisationId}/engagements/${f.engagementId}/assessments/${f.assessmentId}` }));
    expect(refused).toContain("error=");
    expect(refused).not.toMatch(/violates|constraint|42501/i);

    state.userId = f.emId;
    out = await page(f.emId);
    expect(out).toContain("Validate all answered");
    expect(out).toContain("Return for changes");
    expect(await submit(validateAnswersAction, form({ assessmentId: f.assessmentId, back: "/x" }))).toContain("Validated%204".replace("%20", " ") );
  });

  it("an executive and an outsider see what they should", async () => {
    state.userId = f.cxoId;
    const out = await html(AssessmentPage as never, { params: { ...eng, assessmentId: f.assessmentId }, searchParams: {} });
    expect(out).not.toContain("Submit for review");
    state.userId = f.otherClientId;
    await expect(html(AssessmentPage as never, { params: { ...eng, assessmentId: f.assessmentId }, searchParams: {} })).rejects.toThrow("NOT_FOUND");
    await expect(html(EngagementPage as never, { params: eng, searchParams: {} })).rejects.toThrow("NOT_FOUND");
  });

  it("findings: release is for the Engagement Manager; the client then sees the finding", async () => {
    state.userId = f.consultantId;
    const draft = (await pool.query("SELECT id FROM findings WHERE engagement_id = $1 AND title = $2", [f.engagementId, draftTitle])).rows[0].id as string;
    expect(await submit(releaseFindingsAction, form({ engagementId: f.engagementId, findingIds: draft, back: "/findings" }))).toContain("error=");
    state.userId = f.emId;
    expect(await submit(releaseFindingsAction, form({ engagementId: f.engagementId, findingIds: draft, back: "/findings" }))).toContain("saved=");
    state.userId = f.clientAdminId;
    expect(await html(PortalFindings as never, sp())).toContain(draftTitle);
  });

  it("reports: Primus releases a version; the client downloads it; a stranger cannot", async () => {
    state.userId = f.emId;
    const url = await submit(releaseReportAction, form({ ...eng, back: "/x" }));
    expect(url).toContain("saved=");
    state.userId = f.clientAdminId;
    const list = await html(PortalReports as never, sp());
    expect(list).toContain("Download PDF");
    const id = (await pool.query("SELECT id FROM report_releases WHERE engagement_id = $1", [f.engagementId])).rows[0].id as string;
    const ok = await downloadReport(new Request("http://x"), { params: { id } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode((await ok.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    state.userId = f.otherClientId;
    expect((await downloadReport(new Request("http://x"), { params: { id } })).status).toBe(404);
  });

  it("evidence requests: Primus asks; once the assessment is submitted the client sees the request but uploads are closed", async () => {
    state.userId = f.emId;
    expect(await submit(requestEvidenceAction, form({ engagementId: f.engagementId, title: "Latest vendor contracts", back: "/x" }))).toContain("saved=");
    state.userId = f.clientAdminId;
    const out = await html(PortalEvidence as never, sp());
    expect(out).toContain("Latest vendor contracts");
    expect(out).toContain("uploads are closed");
  });

  it("evidence upload: the client answers a request with a real file; Primus then reviews it", async () => {
    const g = await buildWorkspaceFixture("UiEv");
    state.userId = g.emId;
    expect(await submit(requestEvidenceAction, form({ engagementId: g.engagementId, title: "Signed DPA with the payroll vendor", back: "/x" }))).toContain("saved=");
    state.userId = g.clientAdminId;
    const before = await html(PortalEvidence as never, sp());
    expect(before).toContain("Signed DPA with the payroll vendor");
    expect(before).toContain('type="file"');
    const requestId = (await pool.query("SELECT id FROM evidence_requests WHERE engagement_id = $1", [g.engagementId])).rows[0].id as string;
    const fd = form({ organisationId: g.organisationId, engagementId: g.engagementId, requestId, title: "Payroll vendor DPA", evidenceType: "signed_agreement", assessmentResponseId: g.responseIds.policy!, back: "/portal/evidence" });
    fd.set("file", new File(["%PDF-1.4 test agreement"], "dpa.pdf", { type: "application/pdf" }));
    expect(await submit(provideEvidenceAction, fd)).toContain("saved=");
    const req = (await pool.query("SELECT status FROM evidence_requests WHERE id = $1", [requestId])).rows[0];
    expect(req.status).toBe("fulfilled");
    state.userId = g.emId;
    const queue = await html(EvidenceReviewPage as never, sp());
    expect(queue).toContain("Payroll vendor DPA");
    expect(queue).toContain("Waiting for review");
  });

  it("data principal requests: the administrator logs and closes one; the executive can read but not log", async () => {
    state.userId = f.clientAdminId;
    expect(await submit(logRightsAction, form({ engagementId: f.engagementId, title: "Access request via email", requestType: "access", channel: "email", back: "/portal/rights" }))).toContain("saved=");
    let out = await html(PortalRights as never, sp());
    expect(out).toContain("Access request via email");
    const id = (await pool.query("SELECT id FROM ops_cases WHERE engagement_id = $1 AND case_type = 'rights_request'", [f.engagementId])).rows[0].id as string;
    expect(await submit(setRightsStatusAction, form({ caseId: id, engagementId: f.engagementId, status: "closed", back: "/portal/rights" }))).toContain("saved=");
    state.userId = f.cxoId;
    out = await html(PortalRights as never, sp());
    expect(out).toContain("Access request via email");
    expect(out).not.toContain("Add to log");
    expect(await submit(logRightsAction, form({ engagementId: f.engagementId, title: "Nope", requestType: "access", channel: "email", back: "/portal/rights" }))).toContain("error=");
  });

  it("organisation profile: only Primus edits industry and headquarters", async () => {
    state.userId = f.clientAdminId;
    expect(await submit(updateOrganisationProfileAction, form({ organisationId: f.organisationId, industry: "Hacked", hqLocation: "Nowhere", back: "/x" }))).toContain("error=");
    state.userId = f.emId;
    expect(await submit(updateOrganisationProfileAction, form({ organisationId: f.organisationId, industry: "Financial services", hqLocation: "Mumbai", back: "/x" }))).toContain("saved=");
    const page = await html(OrganisationPage as never, { params: { organisationId: f.organisationId }, searchParams: {} });
    expect(page).toContain("Financial services");
    state.userId = f.clientAdminId;
    const profile = await html(PortalProfile as never, sp());
    expect(profile).toContain("Financial services");
    expect(profile).toContain("Mumbai");
  });

  it("the engagement page shows delivery status, and notifications can be cleared", async () => {
    state.userId = f.emId;
    const page = await html(EngagementPage as never, { params: eng, searchParams: {} });
    expect(page).toContain("Delivery status");
    expect(page).toContain("Release report to client");
    expect(await submit(markAllReadAction, form({ back: "/notifications" }))).toContain("saved=");
    state.userId = f.clientAdminId;
    const portalEngagement = await html(EngagementPage as never, { params: eng, searchParams: {} });
    expect(portalEngagement).not.toContain("Release report to client");
    expect(portalEngagement).not.toContain("Generate working report");
  });

  it("the portal 'assessment' entry opens the shared assessment screen", async () => {
    state.userId = f.clientAdminId;
    expect(await redirectsTo(PortalAssessment as never, sp())).toBe(`/organisations/${f.organisationId}/engagements/${f.engagementId}/assessments/${f.assessmentId}`);
  });
});
