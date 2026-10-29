// The new sections, screen by screen: question sets, the question bank, Resources,
// DPO Mate and the "Connect with us" form. Same approach as ui.test.ts: pages are
// rendered to HTML, forms are submitted as FormData, against real PostgreSQL.
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

import { buildWorkspaceFixture, asFixtureSetup, type WsFixture } from "./helpers";
import { grantTenantMembership } from "../rls/helpers";
import PortalQuestions from "@/app/(shell)/portal/questions/page";
import PortalResources from "@/app/(shell)/portal/resources/page";
import DpoMate from "@/app/(shell)/portal/dpo-mate/page";
import Connect from "@/app/(shell)/portal/dpo-mate/connect/page";
import QuestionBankPage from "@/app/(shell)/question-bank/page";
import ResourcesPage from "@/app/(shell)/resources/page";
import Consultations from "@/app/(shell)/consultations/page";
import PortalOverview from "@/app/(shell)/portal/page";
import PortalJourney from "@/app/(shell)/portal/journey/page";
import { GET as preliminary } from "@/app/(shell)/portal/dpo-mate/preliminary-report/route";
import { releaseReportAction, saveDiscoveryAction, submitConsultationAction, updateConsultationAction } from "@/app/(shell)/workspace-actions";

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

const contact = { contactName: "Asha Menon", contactDesignation: "Head of Compliance", contactEmail: "asha@orchidhill.example", contactMobile: "9876543210", submitterIsContact: "yes", organisationName: "Orchid Hill", sectorKey: "broking" };

describe("question sets, Resources, DPO Mate and Connect with us", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("UiSec");
    await asFixtureSetup(async (client) => { await grantTenantMembership(client, f.emId, f.tenantId, "Practice Partner"); });
  });

  it("the client's question page follows the sector they choose in Discovery", async () => {
    state.userId = f.clientAdminId;
    let out = await html(PortalQuestions as never, sp());
    expect(out).toContain("Questions for every organisation");
    expect(out).toContain("You have not told us your sector yet");
    expect(await submit(saveDiscoveryAction, form({ engagementId: f.engagementId, sectionKey: "organisation_profile", a_sector: "insurance", back: "/portal/discovery" }))).toContain("saved=");
    out = await html(PortalQuestions as never, sp({ set: "insurance" }));
    expect(out).toContain("Insurance");
    expect(out).toContain("health and claims information");
    expect(out).not.toContain("KYC and account data");
    await submit(saveDiscoveryAction, form({ engagementId: f.engagementId, sectionKey: "organisation_profile", a_sector: "banking", back: "/portal/discovery" }));
    out = await html(PortalQuestions as never, sp({ set: "banking" }));
    expect(out).toContain("KYC and account data");
    expect(out).not.toContain("health and claims information");
  });

  it("the client can answer a sector question and it is saved", async () => {
    state.userId = f.clientAdminId;
    expect(await submit(saveDiscoveryAction, form({ engagementId: f.engagementId, sectionKey: "sq_banking", a_q1: "partly", back: "/portal/questions?set=banking" }))).toContain("saved=");
    const out = await html(PortalQuestions as never, sp({ set: "banking" }));
    expect(out).toMatch(/<option value="partly" selected/);
  });

  it("Primus sees the whole bank, and choosing a sector changes the questions", async () => {
    state.userId = f.emId;
    const all = await html(QuestionBankPage as never, sp());
    expect(all).toContain("Question bank");
    expect(all).toContain("KYC and account data");
    expect(all).toContain("health and claims information");
    const bank = await html(QuestionBankPage as never, sp({ sector: "banking" }));
    expect(bank).toContain("KYC and account data");
    expect(bank).not.toContain("health and claims information");
    const pharma = await html(QuestionBankPage as never, sp({ sector: "pharma" }));
    expect(pharma).toContain("clinical");
    expect(await html(QuestionBankPage as never, sp({ q: "pharmacovigilance-not-a-real-word" }))).toContain("No question matches");
  });

  it("clients are moved off the Primus-only pages", async () => {
    state.userId = f.clientAdminId;
    expect(await redirectsTo(QuestionBankPage as never, sp())).toBe("/portal/questions");
    expect(await redirectsTo(ResourcesPage as never, sp())).toBe("/portal/resources");
    expect(await redirectsTo(Consultations as never, sp())).toBe("/portal/dpo-mate");
  });

  it("Resources shows the Act, the Rules, the penalties and the chosen sector's laws; the sector changes with the choice", async () => {
    state.userId = f.clientAdminId;
    const base = await html(PortalResources as never, sp());
    for (const t of ["Digital Personal Data Protection Act, 2023", "DPDP Rules, 2025", "Penalty ceiling", "Where to read the original"]) expect(base).toContain(t);
    expect(base).toContain("Banking");
    const pharma = await html(PortalResources as never, sp({ sector: "pharma" }));
    expect(pharma).toContain("CDSCO");
    expect(pharma).toContain("Check before use");
    const psu = await html(PortalResources as never, sp({ sector: "psu" }));
    expect(psu).toContain("Public sector undertakings");
    // Every sector appears once in the picker.
    const picker = psu.match(/aria-label="Sectors".*?<\/nav>/s)![0];
    expect((picker.match(/<a /g) ?? []).length).toBe(19);
    state.userId = f.emId;
    expect(await html(ResourcesPage as never, sp({ sector: "telecom" }))).toContain("DoT");
  });

  it("the client overview and journey speak to the client", async () => {
    state.userId = f.clientAdminId;
    const overview = await html(PortalOverview as never, sp());
    expect(overview).toContain("Your question sets");
    expect(overview).toContain("DPO Mate");
    const journey = await html(PortalJourney as never, sp());
    expect(journey).toContain("You say who you are. We work out which laws apply to you.");
    expect(journey).not.toContain("The client says who they are");
  });

  it("DPO Mate holds back the preliminary report until the final report is out", async () => {
    state.userId = f.clientAdminId;
    let out = await html(DpoMate as never, sp());
    expect(out).toContain("This unlocks once Primus has released your final report");
    expect(out).not.toContain("Download the preliminary report");
    const early = await preliminary(new Request(`http://x/portal/dpo-mate/preliminary-report?e=${f.engagementId}`));
    expect(early.status).toBe(409);
    expect((await preliminary(new Request("http://x/portal/dpo-mate/preliminary-report?e=nope"))).status).toBe(404);
    state.userId = f.emId;
    expect(await submit(releaseReportAction, form({ organisationId: f.organisationId, engagementId: f.engagementId, back: "/engagements" }))).toContain("released");
    state.userId = f.clientAdminId;
    out = await html(DpoMate as never, sp());
    expect(out).toContain("Download the preliminary report");
    expect(out).toContain("Connect with us");
    const res = await preliminary(new Request(`http://x/portal/dpo-mate/preliminary-report?e=${f.engagementId}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    state.userId = f.otherClientId;
    expect((await preliminary(new Request(`http://x/portal/dpo-mate/preliminary-report?e=${f.engagementId}`))).status).toBe(404);
  });

  it("the Connect form shows the notice, asks for the mobile number and the consent, and conveys the 30 minute consultation", async () => {
    state.userId = f.clientAdminId;
    const out = await html(Connect as never, sp());
    for (const t of ["30 minute consultation", "What we collect", "Why we collect it", "Who sees it", "How long we keep it", "Your rights", "Taking back your agreement", "Data Protection Board", "Mobile number", "Book my 30 minute consultation"]) expect(out, t).toContain(t);
    expect(out).toMatch(/name="consent"[^>]*required/);
    expect(out).not.toMatch(/name="consent"[^>]*checked/);
  });

  it("a request without consent goes back to the form with a message; with consent it lands on the thank-you view", async () => {
    state.userId = f.clientAdminId;
    const back = "/portal/dpo-mate/connect";
    const bad = await submit(submitConsultationAction, form({ engagementId: f.engagementId, back, ...contact }));
    expect(bad).toContain("/portal/dpo-mate/connect?error=");
    expect(bad).toContain("tick the box to agree");
    const ok = await submit(submitConsultationAction, form({ engagementId: f.engagementId, back, ...contact, consent: "yes", topics: ["dpdp_alignment", "vendors"] }));
    expect(ok).toMatch(/^\/portal\/dpo-mate\/connect\?sent=[0-9a-f-]{36}$/);
    const thanks = await html(Connect as never, sp({ sent: "1" }));
    expect(thanks).toContain("Book a 30 minute consultation with our experts");
    expect(thanks).toContain("within one working day");
    expect(await html(DpoMate as never, sp())).toContain("30 minute consultation · contact Asha Menon");
  });

  it("Primus reads the request, works it, and the client sees the new status", async () => {
    state.userId = f.emId;
    const page = await html(Consultations as never, sp());
    expect(page).toContain("Orchid Hill");
    expect(page).toContain("+919876543210");
    expect(page).toContain("Email not set up");
    expect(page).toContain("What they agreed to");
    const id = page.match(/name="id" value="([0-9a-f-]{36})"/)![1]!;
    expect(await submit(updateConsultationAction, form({ id, status: "scheduled", note: "Thursday 11 am", back: "/consultations" }))).toContain("saved=");
    state.userId = f.clientAdminId;
    expect(await html(DpoMate as never, sp())).toContain("Booked");
  });
});
