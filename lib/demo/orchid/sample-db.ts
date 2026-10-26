// A small, FICTIONAL back-office database for Orchid Hill, so the PostgreSQL connector has something real to scan.
// Every person, number and address is generated: none belongs to anyone. The shapes (PAN, mobile, email, bank
// account) are real shapes on purpose, because spotting those shapes is what the connector is for.
//
// Most tables match the Data Inventory. Three do NOT (marketing_tmp.leads_export, archive.legacy_kyc_2019,
// reception.visitor_register): a scan finding personal data nobody wrote down is the point of the demo.
import { Client } from "pg";

export const SAMPLE_DB_NAME = "orchid_hill_backoffice";

let seed = 20261022;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + int(0, 25))).join("");
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join("");

const FIRST = ["Aarav", "Aditi", "Akash", "Ananya", "Arjun", "Bhavna", "Chirag", "Deepa", "Divya", "Farhan", "Gauri", "Harsh", "Isha", "Jatin", "Kiran", "Lata", "Manoj", "Neha", "Omkar", "Pooja", "Rahul", "Sana", "Tarun", "Uma", "Vikas", "Yash", "Zoya"];
const LAST = ["Agarwal", "Bhatt", "Chopra", "Desai", "Iyer", "Joshi", "Kamat", "Lal", "Menon", "Naik", "Pandey", "Rane", "Shah", "Tiwari", "Varma"];
const CITY = ["Mumbai", "Pune", "Ahmedabad", "Surat", "Chennai", "Nashik", "Indore", "Thane", "Navi Mumbai"];
const BANK = ["Sample Bank of India", "Demo Co-operative Bank", "Fictional Commercial Bank", "Orchard Savings Bank"];
const SCRIP = ["DEMOBANK", "SAMPLEIT", "ORCHIDAUTO", "FICTIONPOWER", "TESTPHARMA", "MODELFMCG"];

const name = () => `${pick(FIRST)} ${pick(LAST)}`;
const pan = () => `${letters(5)}${digits(4)}${letters(1)}`;
const mobile = () => `${pick(["6", "7", "8", "9"])}${digits(9)}`;
const aadhaar = () => `${int(2, 9)}${digits(11)}`;
const account = () => digits(int(9, 11)); // never 12 digits: that is the Aadhaar shape
const email = (n: string) => `${n.toLowerCase().replace(/[^a-z]+/g, ".")}${int(1, 99)}@example.invalid`;
const address = () => `${int(1, 240)}, ${pick(["MG Road", "Station Road", "Lake View Society", "Park Avenue", "Hill Side Colony"])}, ${pick(CITY)} ${400000 + int(1, 999)}`;
const dob = (minor = false) => `${minor ? int(2010, 2014) : int(1955, 2002)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
const date = (from: number, span: number) => new Date(Date.UTC(from, 0, 1) + int(0, span) * 86400000).toISOString().slice(0, 10);

const lit = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
async function insert(c: Client, table: string, cols: string[], rows: Array<Array<string | number | null>>) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await c.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${chunk.map((r) => `(${r.map(lit).join(", ")})`).join(", ")}`);
  }
}

const DDL = `
CREATE SCHEMA backoffice; CREATE SCHEMA kyc; CREATE SCHEMA crm; CREATE SCHEMA partners; CREATE SCHEMA hr; CREATE SCHEMA reference;
CREATE SCHEMA marketing_tmp; CREATE SCHEMA archive; CREATE SCHEMA reception;
CREATE TABLE backoffice.clients (client_code text PRIMARY KEY, full_name text, pan_no text, date_of_birth date, mobile_number text, email_address text, residential_address text, guardian_name text, kyc_status text, account_opened_on date);
CREATE TABLE backoffice.bank_accounts (client_code text, bank_name text, account_number text, ifsc_code text);
CREATE TABLE backoffice.contract_notes (note_no text PRIMARY KEY, client_code text, trade_date date, scrip text, quantity int, net_amount numeric);
CREATE TABLE kyc.identity_documents (client_code text, document_type text, aadhaar_number text, file_reference text, uploaded_on date);
CREATE TABLE crm.support_tickets (ticket_id text PRIMARY KEY, client_code text, opened_on date, channel text, message_text text);
CREATE TABLE crm.consent_register (consent_id text PRIMARY KEY, client_code text, purpose text, given_on date, status text);
CREATE TABLE partners.authorised_persons (ap_code text PRIMARY KEY, partner_name text, pan_no text, mobile_number text, bank_account_number text, registered_city text);
CREATE TABLE partners.referred_clients (client_code text, ap_code text, referred_on date, client_name text, mobile_number text);
CREATE TABLE hr.employees (emp_code text PRIMARY KEY, full_name text, pan_no text, date_of_birth date, annual_ctc numeric, department text);
CREATE TABLE reference.exchange_holidays (holiday_date date, description text, exchange text);
CREATE TABLE reference.scrip_master (symbol text PRIMARY KEY, isin text, scrip_title text, segment text);
CREATE TABLE marketing_tmp.leads_export (lead_name text, mobile_number text, email_address text, source_campaign text, exported_on date);
CREATE TABLE archive.legacy_kyc_2019 (full_name text, pan_no text, aadhaar_number text, address_line text, migrated_from text);
CREATE TABLE reception.visitor_register (visitor_name text, mobile_number text, pan_no text, visited_on date, meeting_with text);
`;

export function sampleDbUrl(adminUrl: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${SAMPLE_DB_NAME}`;
  return u.toString();
}

/** Creates and fills the sample database. Safe to run again: does nothing if it is already there. */
export async function buildSampleDb(adminUrl: string): Promise<{ created: boolean; url: string }> {
  const url = sampleDbUrl(adminUrl);
  const admin = new Client({ connectionString: new URL("/postgres", adminUrl).toString() });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [SAMPLE_DB_NAME]);
    if (exists.rowCount) return { created: false, url };
    await admin.query(`CREATE DATABASE ${SAMPLE_DB_NAME}`);
  } finally {
    await admin.end();
  }
  seed = 20261022;
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(DDL);
    const clients = Array.from({ length: 400 }, (_, i) => {
      const n = name(), minor = i % 16 === 0;
      return { code: `OH-C${500000 + i}`, n, minor, row: [`OH-C${500000 + i}`, n, pan(), dob(minor), mobile(), email(n), address(), minor ? name() : null, pick(["Verified", "Verified", "Verified", "Pending re-KYC"]), date(2019, 2500)] as Array<string | number | null> };
    });
    await insert(c, "backoffice.clients", ["client_code", "full_name", "pan_no", "date_of_birth", "mobile_number", "email_address", "residential_address", "guardian_name", "kyc_status", "account_opened_on"], clients.map((x) => x.row));
    await insert(c, "backoffice.bank_accounts", ["client_code", "bank_name", "account_number", "ifsc_code"], clients.map((x) => [x.code, pick(BANK), account(), `${letters(4)}0${letters(6)}`]));
    await insert(c, "backoffice.contract_notes", ["note_no", "client_code", "trade_date", "scrip", "quantity", "net_amount"], Array.from({ length: 800 }, (_, i) => [`CN-${900000 + i}`, pick(clients).code, date(2026, 200), pick(SCRIP), int(1, 500), int(1000, 900000)]));
    await insert(c, "kyc.identity_documents", ["client_code", "document_type", "aadhaar_number", "file_reference", "uploaded_on"], clients.map((x) => [x.code, pick(["Aadhaar", "Aadhaar", "Passport", "Voter ID"]), aadhaar(), `kyc/${x.code}/proof.pdf`, date(2020, 2200)]));
    await insert(c, "crm.support_tickets", ["ticket_id", "client_code", "opened_on", "channel", "message_text"], Array.from({ length: 300 }, (_, i) => {
      const cl = pick(clients);
      return [`TKT-${70000 + i}`, cl.code, date(2026, 270), pick(["Phone", "Email", "App chat"]), pick([
        `Please update my mobile number to ${mobile()}. My old number is not working.`,
        `I did not get the contract note. Send it to ${email(cl.n)} again, please.`,
        `Call me back on ${mobile()} about the margin shortfall on my account.`,
        `My PAN is ${pan()}, please correct the spelling of my name in the demat account.`,
        "Unable to log in on the app since the last update. Please help.",
        "Please explain the brokerage charged on the intraday trades last week.",
      ])];
    }));
    await insert(c, "crm.consent_register", ["consent_id", "client_code", "purpose", "given_on", "status"], Array.from({ length: 500 }, (_, i) => [`CNS-${26000 + i}`, pick(clients).code, pick(["Account opening", "Marketing messages", "Research by email", "Group sharing for margin funding"]), date(2026, 270), pick(["Granted", "Granted", "Granted", "Withdrawn"])]));
    const aps = Array.from({ length: 43 }, (_, i) => ({ code: `AP-${1101 + i}`, row: [`AP-${1101 + i}`, name(), pan(), mobile(), account(), pick(CITY)] as Array<string | number | null> }));
    await insert(c, "partners.authorised_persons", ["ap_code", "partner_name", "pan_no", "mobile_number", "bank_account_number", "registered_city"], aps.map((a) => a.row));
    await insert(c, "partners.referred_clients", ["client_code", "ap_code", "referred_on", "client_name", "mobile_number"], clients.slice(0, 150).map((x) => [x.code, pick(aps).code, date(2024, 700), x.n, mobile()]));
    await insert(c, "hr.employees", ["emp_code", "full_name", "pan_no", "date_of_birth", "annual_ctc", "department"], Array.from({ length: 60 }, (_, i) => [`E${1000 + i}`, name(), pan(), dob(), int(4, 60) * 100000, pick(["Trading Operations", "Technology", "Compliance", "Finance", "Customer Support"])]));
    await insert(c, "reference.exchange_holidays", ["holiday_date", "description", "exchange"], Array.from({ length: 14 }, (_, i) => [date(2026, 360 - i * 20), pick(["Republic Day", "Holi", "Good Friday", "Independence Day", "Diwali Laxmi Pujan", "Christmas"]), pick(["NSE", "BSE"])]));
    await insert(c, "reference.scrip_master", ["symbol", "isin", "scrip_title", "segment"], SCRIP.map((s) => [s, `INE${letters(3)}${digits(2)}${letters(2)}${digits(3)}`.slice(0, 12), `${s.charAt(0)}${s.slice(1).toLowerCase()} Limited (fictional)`, "Equity"]));
    await insert(c, "marketing_tmp.leads_export", ["lead_name", "mobile_number", "email_address", "source_campaign", "exported_on"], Array.from({ length: 200 }, () => { const n = name(); return [n, mobile(), email(n), pick(["IPO webinar", "Free demat offer", "Research newsletter"]), date(2026, 120)]; }));
    await insert(c, "archive.legacy_kyc_2019", ["full_name", "pan_no", "aadhaar_number", "address_line", "migrated_from"], Array.from({ length: 120 }, () => [name(), pan(), aadhaar(), address(), "Old KYC server (decommissioned 2020)"]));
    await insert(c, "reception.visitor_register", ["visitor_name", "mobile_number", "pan_no", "visited_on", "meeting_with"], Array.from({ length: 80 }, () => [name(), mobile(), pan(), date(2026, 270), pick(["Operations", "Compliance", "Client servicing"])]));
    await c.query("ANALYZE");
  } finally {
    await c.end();
  }
  return { created: true, url };
}
