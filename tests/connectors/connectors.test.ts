import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import PDFDocument from "pdfkit";
import { Client } from "pg";
import { withRequestDb } from "@/lib/db/request-client";
import { saveAiSettings } from "@/lib/ai/settings";
import { runOnce } from "@/lib/ai/worker";
import { CONNECTORS, availableConnectors, connectorByType } from "@/lib/connectors/catalog";
import { IMPLEMENTATIONS } from "@/lib/connectors/registry";
import { decryptSecret, encryptSecret } from "@/lib/connectors/secrets";
import { classifyName, classifyValue, sensitivityOf } from "@/lib/connectors/classify";
import { createConnector, listAssets, listConnectorRuns, listConnectors, requestConnectorRun, updateConnector, setConnectorEnabled, ConnectorInputError } from "@/lib/connectors/service";
import { folderConnector } from "@/lib/connectors/impl/folder";
import { postgresConnector } from "@/lib/connectors/impl/postgres";
import { websiteConnector } from "@/lib/connectors/impl/website";
import { pool } from "../app/helpers";
import { buildAiFixture, type AiFixture } from "../ai/helpers";

const KEY = Buffer.alloc(32, 7).toString("base64");
process.env.CONNECTOR_SECRET_KEY = KEY;

const ctx = (config: Record<string, unknown>, secret: Record<string, string> | null = null, env: Record<string, string> = {}) => ({
  config, secret, env: { ...process.env, ...env } as NodeJS.ProcessEnv,
});
const RAW = ["rahul.sharma@clientco.in", "ABCDE1234F", "2345 6789 0123", "98765 43210"];
const noRawValues = (x: unknown) => { const s = JSON.stringify(x); for (const v of RAW) expect(s).not.toContain(v); };

describe("catalogue is honest", () => {
  it("lists every connector once, and only implemented ones are runnable", () => {
    const types = CONNECTORS.map((c) => c.type);
    expect(new Set(types).size).toBe(types.length);
    expect(CONNECTORS.length).toBeGreaterThanOrEqual(20);
    for (const c of CONNECTORS) {
      if (c.status === "available" && !c.native) expect(IMPLEMENTATIONS[c.type], c.type).toBeDefined();
      if (c.status === "planned") {
        expect(IMPLEMENTATIONS[c.type], c.type).toBeUndefined();
        expect(c.verification).toMatch(/Not built yet/);
      }
    }
    expect(availableConnectors().map((c) => c.type).sort()).toEqual(["document_folder", "postgres_database", "website_scanner"]);
  });
});

describe("secrets", () => {
  it("round-trips and detects tampering / wrong key / missing key", () => {
    const c = encryptSecret({ connectionString: "postgres://u:p@h/db" });
    expect(c).not.toContain("postgres");
    expect(decryptSecret(c)).toEqual({ connectionString: "postgres://u:p@h/db" });
    expect(() => decryptSecret(c.slice(0, -4) + "AAAA")).toThrow();
    expect(() => decryptSecret(c, { CONNECTOR_SECRET_KEY: Buffer.alloc(32, 9).toString("base64") } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(() => encryptSecret({ a: "b" }, {} as NodeJS.ProcessEnv)).toThrow(/CONNECTOR_SECRET_KEY/);
    expect(() => encryptSecret({ a: "b" }, { CONNECTOR_SECRET_KEY: "short" } as unknown as NodeJS.ProcessEnv)).toThrow(/32 bytes/);
  });
  it("two encryptions of the same value differ", () => {
    expect(encryptSecret({ a: "b" })).not.toBe(encryptSecret({ a: "b" }));
  });
});

describe("classification", () => {
  it("names and values", () => {
    expect(classifyName("customer_email")).toContain("email");
    expect(classifyName("aadhaar_no")).toContain("aadhaar");
    expect(classifyName("date_of_birth")).toContain("dob");
    expect(classifyName("created_at")).toEqual([]);
    expect(classifyValue("PAN ABCDE1234F")).toContain("pan");
    expect(sensitivityOf([])).toBe("none");
    expect(sensitivityOf(["email"])).toBe("personal");
    expect(sensitivityOf(["email", "aadhaar"])).toBe("sensitive");
  });
});

// ------------------------------------------------------------------ folder
describe("folder scan", () => {
  let root: string, outside: string;
  beforeAll(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scan-root-")));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scan-outside-")));
    fs.mkdirSync(path.join(root, "hr", "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "hr", "employees.csv"), "name,email,pan\nRahul,rahul.sharma@clientco.in,ABCDE1234F\n");
    fs.writeFileSync(path.join(root, "hr", "nested", "note.txt"), "Reach me on 98765 43210 about Aadhaar 2345 6789 0123 for onboarding paperwork.");
    fs.writeFileSync(path.join(root, "policy.txt"), "This policy describes how our office manages the weekly lunch menu and nothing about people at all.");
    fs.writeFileSync(path.join(root, "scan.png"), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(root, "hr", "report.docx"), Buffer.from(zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>Contact rahul.sharma@clientco.in regarding the onboarding of new joiners this quarter.</w:t></w:r></w:p></w:body></w:document>") })));
    const pdf = await new Promise<Buffer>((resolve) => {
      const d = new PDFDocument(); const cs: Buffer[] = [];
      d.on("data", (c) => cs.push(c)); d.on("end", () => resolve(Buffer.concat(cs)));
      d.text("Customer PAN ABCDE1234F recorded for KYC purposes during account opening."); d.end();
    });
    fs.writeFileSync(path.join(root, "kyc.pdf"), pdf);
    fs.writeFileSync(path.join(outside, "secret.txt"), "Outside file with email leak@outside.com that must never be read by the scanner.");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link-out.txt"));
    fs.symlinkSync(outside, path.join(root, "dir-link"));
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });

  it("finds which files hold personal data, keeps categories and counts only", async () => {
    const r = await folderConnector.scan(ctx({ path: root }, null, { CONNECTOR_FOLDER_ROOTS: root }));
    const by = Object.fromEntries(r.assets.map((a) => [a.location, a]));
    expect(by["hr/employees.csv"]!.piiCategories).toEqual(expect.arrayContaining(["email", "pan"]));
    expect(by["hr/nested/note.txt"]!.piiCategories).toEqual(expect.arrayContaining(["aadhaar", "phone"]));
    expect(by["hr/report.docx"]!.piiCategories).toContain("email");
    expect(by["kyc.pdf"]!.piiCategories).toContain("pan");
    expect(by["kyc.pdf"]!.sensitivity).toBe("sensitive");
    expect(by["policy.txt"]!.piiCategories).toEqual([]);
    expect(by["policy.txt"]!.sensitivity).toBe("none");
    expect(by["scan.png"]!.attributes.readable).toBe(false);
    expect(by["binary.bin"]!.attributes.reason).toMatch(/not supported/);
    expect(r.stats.filesWithPersonalData).toBe(4);
    noRawValues(r);
  });
  it("never follows a link out of the allowed root", async () => {
    const r = await folderConnector.scan(ctx({ path: root }, null, { CONNECTOR_FOLDER_ROOTS: root }));
    expect(r.assets.some((a) => /secret|link-out|dir-link/.test(a.location))).toBe(false);
    expect(JSON.stringify(r)).not.toContain("leak@outside.com");
  });
  it("refuses folders outside the allowed roots, and does nothing if none are configured", async () => {
    const a = await folderConnector.test(ctx({ path: outside }, null, { CONNECTOR_FOLDER_ROOTS: root }));
    expect(a.ok).toBe(false);
    expect(a.message).toMatch(/outside/);
    const b = await folderConnector.test(ctx({ path: root }, null, { CONNECTOR_FOLDER_ROOTS: "" }));
    expect(b.ok).toBe(false);
    expect(b.message).toMatch(/CONNECTOR_FOLDER_ROOTS/);
    const c = await folderConnector.test(ctx({ path: path.join(root, "..", path.basename(outside)) }, null, { CONNECTOR_FOLDER_ROOTS: root }));
    expect(c.ok).toBe(false);
    await expect(folderConnector.scan(ctx({ path: root + "/../" + path.basename(outside) }, null, { CONNECTOR_FOLDER_ROOTS: root }))).rejects.toThrow();
  });
  it("honours the file limit", async () => {
    const r = await folderConnector.scan(ctx({ path: root, maxFiles: 2 }, null, { CONNECTOR_FOLDER_ROOTS: root }));
    expect(r.stats.filesScanned).toBe(2);
    expect(r.stats.truncated).toBe("yes");
  });
});

// ---------------------------------------------------------------- postgres
describe("PostgreSQL scan", () => {
  const url = process.env.TEST_DATABASE_SUPERUSER_URL!;
  beforeAll(async () => {
    const c = new Client({ connectionString: url }); await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS scan_demo CASCADE; CREATE SCHEMA scan_demo;
      CREATE TABLE scan_demo.customers (id serial primary key, full_name text, email text, mobile text, notes text, created_at timestamptz default now());
      CREATE TABLE scan_demo.kyc (id serial primary key, pan_no text, remarks text);
      CREATE TABLE scan_demo.products (id serial primary key, title text, price numeric);
      INSERT INTO scan_demo.customers (full_name, email, mobile, notes) VALUES ('Rahul Sharma','rahul.sharma@clientco.in','98765 43210','Aadhaar 2345 6789 0123 on file');
      INSERT INTO scan_demo.kyc (pan_no, remarks) VALUES ('ABCDE1234F','verified');
      INSERT INTO scan_demo.products (title, price) VALUES ('Widget', 10);`);
    await c.end();
  });
  afterAll(async () => { const c = new Client({ connectionString: url }); await c.connect(); await c.query("DROP SCHEMA IF EXISTS scan_demo CASCADE"); await c.end(); });

  it("tests the connection read-only", async () => {
    const ok = await postgresConnector.test(ctx({}, { connectionString: url }));
    expect(ok.ok).toBe(true);
    const bad = await postgresConnector.test(ctx({}, { connectionString: "postgres://nobody:wrong@127.0.0.1:1/none" }));
    expect(bad.ok).toBe(false);
    expect((await postgresConnector.test(ctx({}, null))).ok).toBe(false);
  });
  it("finds personal data by column names and by sampled values, stores no values", async () => {
    const r = await postgresConnector.scan(ctx({ schemas: "scan_demo", sampleRows: 50 }, { connectionString: url }));
    const by = Object.fromEntries(r.assets.map((a) => [a.location, a]));
    expect(Object.keys(by).sort()).toEqual(["scan_demo.customers", "scan_demo.kyc", "scan_demo.products"]);
    expect(by["scan_demo.customers"]!.piiCategories).toEqual(expect.arrayContaining(["email", "phone", "aadhaar", "name"]));
    expect(by["scan_demo.customers"]!.sensitivity).toBe("sensitive");
    const notes = (by["scan_demo.customers"]!.attributes.columns as Array<{ name: string; categories: string[] }>).find((c) => c.name === "notes")!;
    expect(notes.categories).toContain("aadhaar"); // seen only in the sampled VALUE, column name is innocent
    expect(by["scan_demo.kyc"]!.piiCategories).toContain("pan");
    expect(by["scan_demo.products"]!.piiCategories).toEqual([]);
    expect(by["scan_demo.products"]!.sensitivity).toBe("none");
    noRawValues(r);
  });
  it("sampleRows = 0 looks at names only", async () => {
    const r = await postgresConnector.scan(ctx({ schemas: "scan_demo", sampleRows: 0 }, { connectionString: url }));
    const notes = (r.assets.find((a) => a.location === "scan_demo.customers")!.attributes.columns as Array<{ name: string; categories: string[] }>).find((c) => c.name === "notes")!;
    expect(notes.categories).toEqual([]);
  });
  it("cannot write: the scan connection is read-only", async () => {
    // Prove the mechanism the scanner relies on.
    const c = new Client({ connectionString: url }); await c.connect();
    await c.query("BEGIN READ ONLY");
    await expect(c.query("CREATE TABLE scan_demo.should_fail (x int)")).rejects.toThrow(/read-only/);
    await c.end();
  });
});

// ----------------------------------------------------------------- website
describe("website scan", () => {
  let good: http.Server, bad: http.Server, goodUrl = "", badUrl = "";
  const listen = (s: http.Server) => new Promise<string>((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as { port: number }).port}`)));
  beforeAll(async () => {
    good = http.createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.setHeader("strict-transport-security", "max-age=1");
      res.setHeader("content-security-policy", "default-src 'self'");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "same-origin");
      if (req.url === "/privacy") {
        res.end(`<html><body><h1>Privacy notice</h1><p>${"We explain the purpose of processing, how long we retain data, and how to withdraw consent. ".repeat(6)}</p><p>Your rights include the right to access, correct and erase your data. Contact our grievance officer. You may complain to the Data Protection Board of India.</p></body></html>`);
      } else {
        res.setHeader("set-cookie", "sid=abc; Secure; HttpOnly; SameSite=Lax");
        res.end(`<html><head><script src="https://cdn.cookielaw.org/onetrust/otSDKStub.js"></script></head><body><a href="/privacy">Privacy Policy</a><div>We use cookies. Manage cookies</div>
          <form action="/signup" method="post"><input type="email" name="email"><input type="tel" name="mobile"><label><input type="checkbox" name="consent"> I agree to the privacy policy</label></form></body></html>`);
      }
    });
    bad = http.createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.setHeader("set-cookie", ["uid=1; Path=/", "track=2"]);
      res.end(`<html><head><script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script></head><body><h1>Welcome</h1>
        <form action="/join" method="post"><input type="email" name="email"><input type="text" name="aadhaar_no"><label><input type="checkbox" name="consent" checked> I consent to marketing</label></form></body></html>`);
    });
    [goodUrl, badUrl] = await Promise.all([listen(good), listen(bad)]);
  });
  afterAll(async () => { await Promise.all([good, bad].map((s) => new Promise<void>((r) => s.close(() => r())))); });
  const allow = { CONNECTOR_ALLOW_PRIVATE_HOSTS: "true" };

  it("refuses private / internal addresses by default", async () => {
    const t = await websiteConnector.test(ctx({ url: goodUrl }, null, { CONNECTOR_ALLOW_PRIVATE_HOSTS: "false" }));
    expect(t.ok).toBe(false);
    expect(t.message).toMatch(/private/);
    const t2 = await websiteConnector.test(ctx({ url: "http://169.254.169.254/latest/meta-data" }, null, { CONNECTOR_ALLOW_PRIVATE_HOSTS: "false" }));
    expect(t2.ok).toBe(false);
    const t3 = await websiteConnector.test(ctx({ url: "file:///etc/passwd" }, null, { CONNECTOR_ALLOW_PRIVATE_HOSTS: "false" }));
    expect(t3.ok).toBe(false);
  });
  it("a well-run site has few observations", async () => {
    expect((await websiteConnector.test(ctx({ url: goodUrl }, null, allow))).ok).toBe(true);
    const r = await websiteConnector.scan(ctx({ url: goodUrl }, null, allow));
    const obs = r.assets.filter((a) => a.assetType === "observation").map((a) => `${a.attributes.severity}: ${a.attributes.message}`);
    expect(obs.join("\n")).not.toMatch(/No link to a privacy notice/);
    expect(obs.join("\n")).not.toMatch(/pre-ticked/);
    expect(obs.join("\n")).not.toMatch(/No cookie consent banner/);
    expect(obs.join("\n")).not.toMatch(/privacy notice does not appear to mention/);
    expect(r.stats.consentTool).toBe("OneTrust");
    expect(r.assets.some((a) => a.assetType === "web_form" && a.piiCategories.includes("email"))).toBe(true);
    expect(r.assets.filter((a) => a.assetType === "web_cookie").map((a) => a.name)).toEqual(["sid"]);
  });
  it("a poor site is flagged with plain-language observations", async () => {
    const r = await websiteConnector.scan(ctx({ url: badUrl }, null, allow));
    const msgs = r.assets.filter((a) => a.assetType === "observation").map((a) => String(a.attributes.message));
    const joined = msgs.join("\n");
    expect(joined).toMatch(/No link to a privacy notice/);
    expect(joined).toMatch(/pre-ticked/);
    expect(joined).toMatch(/Trackers found \(Google Analytics/);
    expect(joined).toMatch(/No cookie consent banner/);
    expect(joined).toMatch(/Cookies readable by page scripts/);
    expect(r.assets.find((a) => a.assetType === "web_form")!.piiCategories).toEqual(expect.arrayContaining(["email", "aadhaar"]));
    expect(r.assets.find((a) => a.assetType === "web_form")!.sensitivity).toBe("sensitive");
    expect(r.assets.some((a) => a.assetType === "observation" && a.attributes.severity === "high")).toBe(true);
  });
  it("an unreachable site fails the test cleanly", async () => {
    const t = await websiteConnector.test(ctx({ url: "http://127.0.0.1:1" }, null, allow));
    expect(t.ok).toBe(false);
  });
});

// --------------------------------------------- through the real worker + RLS
describe("connectors through the platform (service, worker, row-level security)", () => {
  let f: AiFixture, root: string;
  const scope = () => ({ engagementId: f.engagementId, organisationId: f.organisationId });
  async function drain() { let n = 0; while (n < 20 && (await runOnce("conn-worker", () => {}))) n++; return n; }

  beforeAll(async () => {
    f = await buildAiFixture("Conn");
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "conn-root-")));
    fs.writeFileSync(path.join(root, "customers.csv"), "name,email\nRahul,rahul.sharma@clientco.in\n");
    process.env.CONNECTOR_FOLDER_ROOTS = root;
    await withRequestDb(f.emId, (db) =>
      saveAiSettings(db, f.emId, { ...scopeOf(f), enabled: true, level: 2, thresholdSupervised: 0.9, thresholdFull: 0.75, gates: { rejectCriticalEvidence: true, releaseCriticalFindings: true, issueFinalReport: true, sendBreachNotices: true }, allowExternalAi: false }),
    );
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  function scopeOf(x: AiFixture) { return { engagementId: x.engagementId, organisationId: x.organisationId }; }

  it("planned connectors cannot be created; the form is validated", async () => {
    await expect(withRequestDb(f.emId, (db) => createConnector(db, f.emId, scope(), { type: "sharepoint_onedrive", name: "SP", config: {}, secret: {} }))).rejects.toThrow(/roadmap/);
    await expect(withRequestDb(f.emId, (db) => createConnector(db, f.emId, scope(), { type: "document_folder", name: "F", config: {}, secret: {} }))).rejects.toThrow(/Folder path is required/);
    await expect(withRequestDb(f.emId, (db) => createConnector(db, f.emId, scope(), { type: "postgres_database", name: "P", config: {}, secret: {} }))).rejects.toThrow(/Connection string is required/);
  });
  it("only someone with AI-configure can add or change connectors; a consultant can view and run", async () => {
    await expect(withRequestDb(f.consultantId, (db) => createConnector(db, f.consultantId, scope(), { type: "document_folder", name: "X", config: { path: root }, secret: {} }))).rejects.toThrow();
  });

  it("add → test → scan: the worker runs it as the AI agent and keeps metadata only", async () => {
    const c = await withRequestDb(f.emId, (db) => createConnector(db, f.emId, scope(), { type: "document_folder", name: "HR share", config: { path: root }, secret: {} }));
    expect(c.status).toBe("configured");
    await withRequestDb(f.consultantId, (db) => requestConnectorRun(db, f.consultantId, scope(), c.id, "test"));
    await withRequestDb(f.consultantId, (db) => requestConnectorRun(db, f.consultantId, scope(), c.id, "scan"));
    await drain();
    const [list, runs, assets] = await withRequestDb(f.consultantId, async (db) => [
      await listConnectors(db, f.consultantId, scope()),
      await listConnectorRuns(db, f.consultantId, scope()),
      await listAssets(db, f.consultantId, scope()),
    ] as const);
    expect(list[0]!.status).toBe("connected");
    expect(list[0]!.lastTestOk).toBe(true);
    expect(runs.map((r) => `${r.runType}:${r.status}`).sort()).toEqual(["scan:succeeded", "test:succeeded"]);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.piiCategories).toContain("email");
    expect(JSON.stringify(assets)).not.toContain("rahul.sharma@clientco.in");
    const ev = await pool.query(`SELECT message, actor_user_id FROM ai_events WHERE engagement_id = $1 AND event_type LIKE 'connector_%' ORDER BY created_at`, [f.engagementId]);
    expect(ev.rows.some((r) => /Scanned "HR share"/.test(r.message) && r.actor_user_id === f.agentId)).toBe(true);
  });

  it("a rescan updates in place (no duplicates)", async () => {
    const [c] = await withRequestDb(f.emId, (db) => listConnectors(db, f.emId, scope()));
    await withRequestDb(f.emId, (db) => requestConnectorRun(db, f.emId, scope(), c!.id, "scan"));
    await drain();
    expect(await withRequestDb(f.emId, (db) => listAssets(db, f.emId, scope()))).toHaveLength(1);
  });

  it("credentials are encrypted at rest, unreadable to people, and usable only by the AI at run time", async () => {
    const url = process.env.TEST_DATABASE_SUPERUSER_URL!;
    const c = await withRequestDb(f.emId, (db) => createConnector(db, f.emId, scope(), { type: "postgres_database", name: "Core DB", config: { sampleRows: "10" }, secret: { connectionString: url } }));
    expect(c.hasSecret).toBe(true);
    const stored = await pool.query(`SELECT ciphertext FROM ai_connector_secrets WHERE connector_id = $1`, [c.id]);
    expect(stored.rows[0].ciphertext).not.toContain("postgres");
    expect(stored.rows[0].ciphertext).not.toContain("5432");
    // No person, not even the engagement manager, can read the secrets table or call the reader.
    await expect(withRequestDb(f.emId, (db) => db.execute(`SELECT * FROM ai_connector_secrets` as never))).rejects.toThrow();
    await expect(withRequestDb(f.emId, async (db) => { const { sql } = await import("drizzle-orm"); return db.execute(sql`SELECT * FROM public.get_ai_connector_secret(${c.id}::uuid)`); })).rejects.toThrow();
    await withRequestDb(f.emId, (db) => requestConnectorRun(db, f.emId, scope(), c.id, "test"));
    await drain();
    const after = await withRequestDb(f.emId, (db) => listConnectors(db, f.emId, scope()));
    const core = after.find((x) => x.name === "Core DB")!;
    expect(core.lastTestOk).toBe(true);
    expect(core.lastTestMessage).toMatch(/Connected \(read-only\)/);
    // Changing settings without retyping the password keeps the saved one.
    await withRequestDb(f.emId, (db) => updateConnector(db, f.emId, scope(), c.id, { name: "Core DB", config: { sampleRows: "5" }, secret: {} }));
    await withRequestDb(f.emId, (db) => requestConnectorRun(db, f.emId, scope(), c.id, "test"));
    await drain();
    const again = (await withRequestDb(f.emId, (db) => listConnectors(db, f.emId, scope()))).find((x) => x.name === "Core DB")!;
    expect(again.lastTestOk).toBe(true);
  });

  it("a bad setting is recorded as a failed run, not retried forever", async () => {
    const c = await withRequestDb(f.emId, (db) => createConnector(db, f.emId, scope(), { type: "document_folder", name: "Wrong place", config: { path: "/definitely/not/here" }, secret: {} }));
    await withRequestDb(f.emId, (db) => requestConnectorRun(db, f.emId, scope(), c.id, "scan"));
    await drain();
    const row = (await withRequestDb(f.emId, (db) => listConnectors(db, f.emId, scope()))).find((x) => x.id === c.id)!;
    expect(row.status).toBe("error");
    expect(row.lastTestMessage).toMatch(/not found|outside/);
    const jobs = await pool.query(`SELECT status FROM ai_jobs WHERE engagement_id = $1 AND subject_id = $2`, [f.engagementId, c.id]);
    expect(jobs.rows.map((r) => r.status)).toEqual(["succeeded"]);
  });

  it("a switched-off connector is not run", async () => {
    const [c] = await withRequestDb(f.emId, (db) => listConnectors(db, f.emId, scope()));
    await withRequestDb(f.emId, (db) => setConnectorEnabled(db, f.emId, scope(), c!.id, false));
    await expect(withRequestDb(f.emId, (db) => requestConnectorRun(db, f.emId, scope(), c!.id, "scan"))).rejects.toThrow(ConnectorInputError);
    await withRequestDb(f.emId, (db) => setConnectorEnabled(db, f.emId, scope(), c!.id, true));
  });

  it("outsiders cannot see connectors or discovered assets", async () => {
    const other = await buildAiFixture("ConnOther");
    await expect(withRequestDb(other.emId, (db) => listConnectors(db, other.emId, scope()))).rejects.toThrow();
    const rows = await withRequestDb(other.emId, (db) => db.execute(`SELECT id FROM ai_connectors` as never));
    expect((rows as { rows: unknown[] }).rows).toHaveLength(0);
  });
});
