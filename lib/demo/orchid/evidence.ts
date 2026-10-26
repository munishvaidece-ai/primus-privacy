// The evidence and support documents for the Orchid Hill demo. Invented. Each one is written the way a
// real policy, register or report reads, so the AI is reading real prose, not keywords.
import { FIRM } from "./content";

export type DocFormat = "docx" | "pdf" | "xlsx" | "txt" | "png";
export type Line = string; // "# heading", "- bullet", or a paragraph
export interface DocSpec {
  file: string;
  format: DocFormat;
  /** Control codes this document is meant to support (the Evidence Index says so). */
  controls: string[];
  doctype: "Policy" | "Procedure" | "Report" | "Screenshot" | "Certificate" | "Agreement" | "Log" | "Other";
  title: string;
  date: string;
  owner: string;
  description: string;
  /** docx/pdf/txt body. */
  lines?: Line[];
  /** xlsx body: first row is the header. */
  table?: { sheet: string; header: string[]; rows: Array<Array<string | number>>; intro?: string[] };
  /** Why this document is in the pack, for the talking points. */
  role: "good" | "weak" | "irrelevant" | "unreadable" | "draft" | "not_uploaded" | "not_indexed";
}

const ORG = FIRM.name;
const pol = (name: string, owner: string, version: string, approved: string, effective: string, review: string, scope: string): Line[] => [
  `# ${name}`,
  `${ORG}. Document owner: ${owner}. Version ${version}. Approved by ${approved}. Effective from ${effective}. Last reviewed ${effective}. Next review ${review}.`,
  `Scope: ${scope}`,
];

// ---------- deterministic pseudo-random data for the larger registers ----------
let seed = 20260901;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
const FIRST = ["Aarav", "Aditi", "Akash", "Ananya", "Arjun", "Bhavna", "Chirag", "Deepa", "Divya", "Farhan", "Gauri", "Harsh", "Isha", "Jatin", "Kiran", "Lata", "Manoj", "Neha", "Omkar", "Pooja", "Rahul", "Sana", "Tarun", "Uma", "Vikas", "Yash", "Zoya"];
const LAST = ["Agarwal", "Bhatt", "Chopra", "Desai", "Iyer", "Joshi", "Kamat", "Lal", "Menon", "Naik", "Pandey", "Rane", "Shah", "Tiwari", "Varma"];
const DEPTS = ["Client Onboarding and KYC", "Trading Operations", "Depository Operations", "Risk Management and Surveillance", "Technology and Information Security", "Customer Support and Grievances", "Authorised Persons Network", "Marketing and Research", "Human Resources", "Finance and Accounts"];
const person = () => `${pick(FIRST)} ${pick(LAST)}`;
const day = (base: string, plus: number) => new Date(new Date(`${base}T00:00:00Z`).getTime() + plus * 86_400_000).toISOString().slice(0, 10);

const trainingRows = (() => {
  const rows: Array<Array<string | number>> = [];
  for (let i = 1; i <= 642; i++) {
    const done = rnd() < 0.73;
    rows.push([`OH${String(1000 + i)}`, person(), pick(DEPTS), done ? "Completed" : rnd() < 0.5 ? "Not started" : "In progress", done ? day("2026-04-01", Math.floor(rnd() * 150)) : "", done ? Math.round(70 + rnd() * 30) : ""]);
  }
  return rows;
})();

const consentRows = (() => {
  const rows: Array<Array<string | number>> = [];
  for (let i = 1; i <= 420; i++) {
    rows.push([`CNS-${String(26000 + i)}`, `OH-C${String(500000 + Math.floor(rnd() * 90000))}`, pick(["Account opening: data processing", "Account opening: KYC verification", "Marketing messages", "Marketing messages", "Group sharing: margin funding offers", "Research reports by email"]), day("2026-09-01", Math.floor(rnd() * 25)), pick(["App", "App", "Website", "Branch (paper form)"]), pick(["N-2026-03", "N-2026-03", "N-2025-11"]), pick(["Granted", "Granted", "Granted", "Withdrawn"])]);
  }
  return rows;
})();

const accessRows = (() => {
  const rows: Array<Array<string | number>> = [];
  const systems = ["OH Trade admin", "ClientSphere Back Office", "DP Core", "OH Onboard", "SupportDesk CRM", "Risk and Surveillance Engine"];
  for (let i = 1; i <= 140; i++) rows.push([`USR-${2000 + i}`, person(), pick(DEPTS), pick(systems), pick(["Read", "Read", "Read and write", "Administrator"]), pick(["Q1 FY27", "Q1 FY27", "Not reviewed"]), pick(["Active", "Active", "Active", "Left the company, still active"])]);
  return rows;
})();

const incidentRows: Array<Array<string | number>> = [
  ["INC-2026-01", "2026-04-03", "Phishing email reported by 3 staff", "Medium", "No personal data lost", "2026-04-03 11:40", "2026-04-03 15:55", 4.2, "Closed"],
  ["INC-2026-02", "2026-04-19", "Brute-force attempts on client login", "Medium", "No accounts accessed", "2026-04-19 02:10", "2026-04-19 06:50", 4.7, "Closed"],
  ["INC-2026-03", "2026-05-02", "Misdirected contract notes email (3 clients)", "Low", "3 clients' trade details seen by wrong person", "2026-05-02 16:20", "2026-05-02 21:05", 4.75, "Closed"],
  ["INC-2026-04", "2026-05-21", "Partner portal credential sharing", "High", "Possible exposure of 40 clients' profiles", "2026-05-21 09:30", "2026-05-21 14:10", 4.7, "Closed"],
  ["INC-2026-05", "2026-06-08", "Malware on a branch laptop", "Medium", "No client data on device", "2026-06-08 12:00", "2026-06-08 16:30", 4.5, "Closed"],
  ["INC-2026-06", "2026-06-24", "DDoS on trading web front end", "High", "No data loss", "2026-06-24 10:05", "2026-06-24 13:15", 3.2, "Closed"],
  ["INC-2026-07", "2026-07-11", "Vendor SMS gateway sent OTPs to wrong numbers", "High", "OTPs for 61 clients delivered to others", "2026-07-11 08:15", "2026-07-11 17:20", 9.1, "Closed"],
  ["INC-2026-08", "2026-07-29", "Lost branch laptop", "Medium", "Disk encrypted; no loss confirmed", "2026-07-29 15:00", "2026-07-29 19:40", 4.7, "Closed"],
  ["INC-2026-09", "2026-08-05", "Unauthorised access to a test database", "Medium", "Masked data only", "2026-08-05 10:45", "2026-08-05 14:30", 3.75, "Closed"],
  ["INC-2026-10", "2026-08-14", "Expired TLS certificate on partner portal", "Low", "No data loss", "2026-08-14 09:00", "2026-08-14 12:20", 3.3, "Closed"],
  ["INC-2026-11", "2026-08-27", "Fraudulent call using a client's masked data", "Medium", "1 client affected", "2026-08-27 13:25", "2026-08-27 17:35", 4.2, "Closed"],
  ["INC-2026-12", "2026-09-04", "Ransomware attempt blocked at email gateway", "High", "No data loss", "2026-09-04 07:50", "2026-09-04 11:25", 3.6, "Closed"],
  ["INC-2026-13", "2026-09-12", "API key leaked in a public code repository", "High", "Key revoked within 30 minutes; no misuse found", "2026-09-12 18:10", "2026-09-12 21:50", 3.7, "Closed"],
  ["INC-2026-14", "2026-09-19", "Privileged account used outside working hours", "Medium", "Reviewed: authorised maintenance", "2026-09-19 22:30", "2026-09-20 02:40", 4.2, "Closed"],
];

const vendorRows: Array<Array<string | number>> = [
  ["CloudNine Hosting", "Cloud infrastructure", "All client data", "Data processing agreement signed 2025-02-10", "Yes", "Yes", "Yes", "India"],
  ["Sahi eSign Technologies", "eSign and eKYC", "Name, masked Aadhaar, signature", "Data processing agreement signed 2025-06-01", "Yes", "Yes", "Yes", "India"],
  ["KYCBridge Solutions", "Document and face verification", "PAN, photograph", "Services agreement only; no breach notice or deletion terms", "Partly", "No", "No", "India"],
  ["PingWave SMS", "OTP and promotional SMS", "Mobile numbers, messages", "No data protection terms", "No", "No", "No", "India"],
  ["MailForge Email Services", "Email delivery and archive", "Names, email addresses, statements", "Services agreement with confidentiality clause only", "Partly", "No", "Yes", "India"],
  ["CallVault Recorder", "Call recording", "Voice recordings", "Data processing agreement signed 2025-09-15", "Yes", "Yes", "Yes", "India"],
  ["InsightLoop Analytics", "App and web analytics", "Device ID, IP address, usage", "Click-through terms only", "No", "No", "No", "Singapore"],
  ["PeopleDesk Cloud", "HR and payroll", "Employee records", "Data processing agreement signed 2025-04-20", "Yes", "Yes", "Yes", "India"],
  ["Central Depository (CDSL)", "Depository services", "Demat holdings", "Operating instructions and agreement", "Yes", "Yes", "Yes", "India"],
  ["PayLink Gateway", "Payments", "Bank account details", "Data processing agreement signed 2025-08-05", "Yes", "Yes", "Yes", "India"],
  ["DocuVault Archival", "Paper form storage", "Scanned and paper forms", "No contract on data protection", "No", "No", "No", "India"],
];

export const EVIDENCE: DocSpec[] = [
  {
    file: "Privacy_Policy_v3.docx", format: "docx", controls: ["GOV-02"], doctype: "Policy", title: "Privacy policy v3.0", date: "2026-03-28", owner: "Meera Kapoor, Chief Compliance Officer", role: "good",
    description: "Board-approved written privacy policy with owner, version and review date.",
    lines: [
      ...pol("Privacy Policy", "Meera Kapoor, Chief Compliance Officer", "3.0", "the Board of Directors on 28 March 2026 and signed by the Managing Director", "1 April 2026", "31 March 2027", "this privacy policy applies to all employees, contractors, authorised persons and systems of Orchid Hill that process personal data."),
      "# 1. Purpose",
      "This written privacy policy sets out how Orchid Hill collects, uses, shares, keeps and protects personal data and who in management is accountable for it. It is approved by management and reviewed every year.",
      "# 2. Ownership and approval",
      "The Chief Compliance Officer is the named owner of this privacy policy. The Board of Directors approves it. Every change gets a new version number and a new review date, recorded in the table at the end of this document.",
      "# 3. Principles",
      "- Personal data is collected only for a stated purpose and used only for that purpose.",
      "- Clients are given a notice before their data is collected and can exercise their rights.",
      "- Personal data is protected by reasonable security safeguards and erased when no longer needed unless the law requires it to be kept.",
      "# 4. Review",
      "Management reviews this privacy policy once a year, or sooner if the law changes. The next review date is 31 March 2027.",
      "# Version history",
      "Version 1.0 (2023), version 2.0 (2024), version 3.0 (April 2026) approved by the Board.",
    ],
  },
  {
    file: "Privacy_Governance_Charter.docx", format: "docx", controls: ["GOV-01"], doctype: "Policy", title: "Privacy governance and accountability charter", date: "2026-03-28", owner: "Meera Kapoor, Chief Compliance Officer", role: "good",
    description: "Names who is accountable for data protection and how management is told about it.",
    lines: [
      ...pol("Privacy Governance and Accountability Charter", "Meera Kapoor, Chief Compliance Officer", "2.0", "the Board of Directors", "1 April 2026", "31 March 2027", "all business units of Orchid Hill and its authorised persons."),
      "# Accountability",
      "A named owner is accountable for data protection: the Chief Compliance Officer. A documented structure supports the owner. A Privacy Council of the Chief Information Security Officer, the Chief Risk Officer, the Head of Customer Care and the Head of HR meets every quarter.",
      "# Management reporting",
      "Management reporting happens at a regular interval. The Chief Compliance Officer reports privacy and data protection matters to the Board Risk Committee every quarter, covering incidents, rights requests, vendor reviews and open actions.",
      "# Structure",
      "- Board Risk Committee: oversight of privacy governance and accountability.",
      "- Chief Compliance Officer: accountable owner of data protection.",
      "- Privacy Council: documented structure meeting quarterly; minutes are kept.",
      "- Business unit heads: responsible for privacy in their unit.",
    ],
  },
  {
    file: "Training_Attendance_FY26.xlsx", format: "xlsx", controls: ["GOV-03"], doctype: "Log", title: "Staff privacy awareness training attendance FY26", date: "2026-09-01", owner: "Leena Thomas, Head of HR", role: "weak",
    description: "Attendance register for the annual privacy awareness training; shows who completed.",
    table: { intro: ["Staff privacy awareness training: attendance register for the financial year 2026-27. Document owner: Leena Thomas, Head of HR. Version 1.0, dated 1 September 2026. Approved by the Chief Compliance Officer.", "Staff who handle personal data complete induction and periodic refresher training, and attendance is recorded. This register records attendance for every employee: the status, the date completed and the assessment score. Scope: all 642 employees of Orchid Hill."], sheet: "Training register", header: ["Employee ID", "Name", "Department", "Status", "Completed on", "Assessment score"], rows: trainingRows },
  },
  {
    file: "Data_Inventory_Extract.xlsx", format: "xlsx", controls: ["INV-01"], doctype: "Report", title: "Personal data inventory and record of processing", date: "2026-08-30", owner: "Meera Kapoor, Chief Compliance Officer", role: "good",
    description: "Maintained record of what personal data is held, why, where, who has it and how long it is kept.",
    table: { intro: ["Personal data inventory and records of processing. Document owner: Meera Kapoor, Chief Compliance Officer. Version 2.0, last reviewed 30 August 2026, next review 28 February 2027. Approved by the Chief Compliance Officer.", "This is a maintained record of what personal data is held, why, where, who has it and how long it is kept. Scope: all business units."], sheet: "Record of processing", header: ["Activity", "Personal data held", "Purpose", "Where it is held", "Who has it", "How long it is kept", "Last reviewed"], rows: [
      ["Client onboarding and KYC", "Name, PAN, address, bank account, photograph", "Verify identity and open accounts", "OH Onboard, ClientSphere Back Office", "Onboarding team, KYCBridge", "8 years after closure", "2026-08-30"],
      ["Order execution and settlement", "Client code, bank account, holdings, orders", "Execute and settle trades", "OH Trade, ClientSphere Back Office", "Trading operations", "8 years", "2026-08-30"],
      ["Demat operations", "Demat number, nominee, holdings", "Maintain demat accounts", "DP Core", "DP operations, CDSL", "8 years after closure", "2026-08-30"],
      ["Customer support", "Name, mobile, email, call recordings", "Answer queries and complaints", "SupportDesk CRM, CallVault", "Customer care", "5 years; recordings 2 years", "2026-08-30"],
      ["Marketing", "Name, mobile, email, device data", "Promote services", "SupportDesk CRM, MailForge", "Marketing", "Not defined", "2026-08-30"],
      ["Payroll", "Employee identity, bank account, salary", "Pay staff", "PeopleDesk", "HR", "8 years after exit", "2026-08-30"],
    ] },
  },
  {
    file: "Privacy_Notice_Client_Onboarding.pdf", format: "pdf", controls: ["NOT-01"], doctype: "Policy", title: "Privacy notice shown at account opening", date: "2026-03-30", owner: "Meera Kapoor, Chief Compliance Officer", role: "good",
    description: "The notice given to clients when personal data is requested.",
    lines: [
      "# Privacy Notice for Clients (Version N-2026-03)",
      `${ORG}. Notice version N-2026-03, effective from 1 April 2026. Approved by the Chief Compliance Officer. Owner: Chief Compliance Officer. This notice applies to everyone who opens a trading or demat account with us.`,
      "# What data we ask for and why",
      "When you open an account we ask for your name, PAN, address, date of birth, bank details, photograph and signature. We use the data to verify your identity, open your trading and demat accounts, execute and settle your orders, and comply with SEBI and anti-money-laundering rules. The purpose is stated next to each request in the app.",
      "# Your rights and how to complain",
      "You can ask to access, correct, complete, update or erase your personal data, and to nominate another person to act for you. Write to privacy@orchidhill.example or use the Privacy section of the app. If you are not satisfied you can complain to the Data Protection Board of India.",
      "# Who we share it with",
      "Exchanges, the depository (CDSL), the KYC registration agency and service providers who work under written contracts with us.",
    ],
  },
  {
    file: "Consent_Management_Procedure.docx", format: "docx", controls: ["CON-01", "CON-03"], doctype: "Procedure", title: "Consent collection and records procedure", date: "2026-03-30", owner: "Dev Malhotra, Chief Information Security Officer", role: "good",
    description: "How consent is requested, recorded and kept.",
    lines: [
      ...pol("Consent Collection and Records Procedure", "Dev Malhotra, CISO", "2.1", "the Chief Compliance Officer", "1 April 2026", "31 March 2027", "every screen and form where Orchid Hill asks clients for consent."),
      "# Collection",
      "Consent is free, specific, informed, unconditional and unambiguous. It is given by a clear affirmative action: the client ticks an unticked box next to a purpose. Consent is limited to the stated purpose, and consent for marketing is never bundled with account opening.",
      "# Records",
      "Each consent is recorded with what was agreed, when, how and which notice version applied. The record is kept in the SupportDesk CRM consent register with the client code, the purpose, the date and time, the channel and the notice version.",
      "# Review",
      "The Chief Compliance Officer reviews a sample of consent records every quarter.",
    ],
  },
  {
    file: "Consent_Register_Extract_Sep26.xlsx", format: "xlsx", controls: ["CON-03"], doctype: "Log", title: "Consent register extract, September 2026", date: "2026-09-26", owner: "Kavita Deshmukh, Head of Customer Care", role: "good",
    description: "Extract of consent records with purpose, channel and notice version.",
    table: { intro: ["Consent records extract for September 2026. Owner: Kavita Deshmukh, Head of Customer Care. Version 1.0, dated 26 September 2026. Approved by the Chief Compliance Officer.", "Each consent is recorded with what was agreed, when, how and which notice version applied. This extract lists every consent recorded in the SupportDesk consent register, with the client code, purpose, date, channel, notice version and status. Scope: all channels."], sheet: "Consent register", header: ["Consent ID", "Client code", "Purpose", "Date", "Channel", "Notice version", "Status"], rows: consentRows },
  },
  {
    file: "Legitimate_Use_Register.docx", format: "docx", controls: ["LEG-01"], doctype: "Policy", title: "Legitimate use basis register", date: "2026-04-02", owner: "Meera Kapoor, Chief Compliance Officer", role: "good",
    description: "Lists processing that relies on a legitimate use rather than consent, with the basis and approval.",
    lines: [
      ...pol("Legitimate Use Basis Register", "Meera Kapoor, Chief Compliance Officer", "1.2", "the Chief Compliance Officer and the Head of Legal", "2 April 2026", "31 March 2027", "all processing at Orchid Hill that does not rely on consent."),
      "# Where processing relies on a legitimate use",
      "Where processing relies on a legitimate use instead of consent, the basis is identified, documented and approved. The register lists each activity, the legal basis, the approving officer and the date.",
      "- Client KYC and identity verification: legal obligation under SEBI regulations and the Prevention of Money Laundering Act. Approved by the Chief Compliance Officer.",
      "- Trade, order and contract note records: legal obligation under SEBI and exchange rules. Approved by the Chief Compliance Officer.",
      "- Employee records and payroll: employment. Approved by the Head of HR.",
      "- Suspicious transaction reporting to FIU-IND: legal obligation. Approved by the Principal Officer.",
    ],
  },
  {
    file: "Purpose_Limitation_Standard.docx", format: "docx", controls: ["PUR-01"], doctype: "Policy", title: "Purpose limitation standard", date: "2026-04-02", owner: "Meera Kapoor, Chief Compliance Officer", role: "good",
    description: "Data is used only for the notified purpose; new purposes are reviewed before use.",
    lines: [
      ...pol("Purpose Limitation Standard", "Meera Kapoor, Chief Compliance Officer", "1.1", "the Chief Compliance Officer", "2 April 2026", "31 March 2027", "all uses of personal data collected by Orchid Hill."),
      "# Rule",
      "Personal data is used only for the purpose notified to the client. A business unit that wants to use personal data for a new purpose must raise a purpose review request before the use starts.",
      "# Purpose review",
      "New purposes are reviewed by the Privacy Council before use. The review checks the notified purpose, whether fresh consent or a legitimate use applies, and the effect on the client. The decision, date and approver are recorded.",
    ],
  },
  {
    file: "Data_Retention_and_Erasure_Schedule.docx", format: "docx", controls: ["RET-01", "BRK-11"], doctype: "Policy", title: "Data retention and erasure schedule v2", date: "2026-04-05", owner: "Meera Kapoor, Chief Compliance Officer", role: "good",
    description: "Retention schedule for client records, order logs and recorded communications, with the legal duty behind each period.",
    lines: [
      ...pol("Data Retention and Erasure Schedule", "Meera Kapoor, Chief Compliance Officer", "2.0", "the Chief Compliance Officer and the Chief Risk Officer", "5 April 2026", "31 March 2027", "all categories of personal data held by Orchid Hill."),
      "# Rule",
      "A retention schedule sets how long each category of personal data is kept. Personal data is erased when the purpose ends unless the law requires it to be kept. The schedule states which legal duty sets each period.",
      "# Schedule",
      "- Client identity records and KYC documents: 8 years after the account is closed. Legal duty: PMLA and SEBI rules.",
      "- Contract notes, order and trade logs: 8 years. Legal duty: SEBI and exchange rules.",
      "- Recorded calls and communications: 8 years for trading related calls, 2 years for service calls. Legal duty: SEBI rules on recorded communications.",
      "- Suspicious transaction records: 5 years after the relationship ends. Legal duty: PMLA.",
      "- Employee records: 8 years after the employee leaves.",
      "# Erasure",
      "After the period ends, client records are erased from production systems within 90 days and from backups at their next rotation. Erasure is recorded.",
    ],
  },
  {
    file: "Information_Security_Policy_v4.docx", format: "docx", controls: ["SEC-01", "BRK-01"], doctype: "Policy", title: "Information security and cyber resilience policy v4", date: "2026-03-25", owner: "Dev Malhotra, Chief Information Security Officer", role: "good",
    description: "Board-approved cyber security and resilience policy covering systems that hold client data.",
    lines: [
      ...pol("Information Security and Cyber Resilience Policy", "Dev Malhotra, Chief Information Security Officer", "4.0", "the Board of Directors on 25 March 2026", "1 April 2026", "31 March 2027", "all systems that hold client data, including the trading platform, back office, depository and onboarding systems."),
      "# Cyber security and resilience framework",
      "This board-approved cyber security and cyber resilience policy implements SEBI's cybersecurity and cyber resilience framework (CSCRF). A designated Chief Information Security Officer is accountable. Security monitoring runs around the clock through a security operations centre. A periodic review is done every year and after any major incident.",
      "# Security safeguards for personal data",
      "Reasonable security safeguards protect personal data: encryption of data at rest and in transit, masking of PAN, bank and demat details, access control by role, logging of access to client data, and backups protected and tested. Safeguards cover the systems that hold client data.",
      "# Monitoring",
      "Security events are logged and monitored. Alerts are triaged by the security operations centre and incidents are handled under the Incident Response Plan.",
    ],
  },
  {
    file: "Access_Control_Standard.docx", format: "docx", controls: ["SEC-02"], doctype: "Policy", title: "Access control and least privilege standard", date: "2026-03-25", owner: "Dev Malhotra, Chief Information Security Officer", role: "good",
    description: "Access to personal data is granted by role, reviewed regularly and removed promptly.",
    lines: [
      ...pol("Access Control and Least Privilege Standard", "Dev Malhotra, Chief Information Security Officer", "3.1", "the Chief Information Security Officer", "1 April 2026", "31 March 2027", "all staff, contractors and authorised persons with access to personal data."),
      "# Rule",
      "Access to personal data is granted by role on the principle of least privilege. Access is reviewed regularly: managers review the access of their team every quarter and the results are recorded. Access is removed promptly when people leave or change roles, within 24 hours of the leaving date.",
      "# Review",
      "Each quarter the security team sends an access review to every manager. Unreviewed access is escalated to the Chief Information Security Officer.",
    ],
  },
  {
    file: "Access_Review_Q1_FY27.xlsx", format: "xlsx", controls: ["SEC-02"], doctype: "Log", title: "Access review Q1 FY27", date: "2026-07-20", owner: "Dev Malhotra, Chief Information Security Officer", role: "weak",
    description: "Results of the quarterly access review, including who is still active.",
    table: { intro: ["Access review for the first quarter of FY27. Owner: Dev Malhotra, Chief Information Security Officer. Version 1.0, dated 20 July 2026. Approved by the Chief Information Security Officer.", "Access to personal data is granted by role, reviewed regularly, and removed promptly when people leave or change roles. This register shows each user's access by system and whether the manager has reviewed it. Scope: all systems that hold personal data."], sheet: "Access review", header: ["User ID", "Name", "Department", "System", "Access level", "Review status", "Account status"], rows: accessRows },
  },
  {
    file: "Incident_Response_Plan.docx", format: "docx", controls: ["BRE-01"], doctype: "Procedure", title: "Incident response plan v2.2", date: "2026-02-15", owner: "Dev Malhotra, Chief Information Security Officer", role: "good",
    description: "Tested plan to detect, contain and investigate a personal data breach.",
    lines: [
      ...pol("Personal Data Breach Detection and Response Plan", "Dev Malhotra, Chief Information Security Officer", "2.2", "the Chief Information Security Officer and the Chief Compliance Officer", "15 February 2026", "14 February 2027", "all personal data breaches and cyber incidents at Orchid Hill."),
      "# Detect, contain and investigate",
      "A tested plan detects, contains and investigates a personal data breach. Detection comes from security monitoring, staff reports and vendor notices. The incident commander contains the breach, preserves evidence and investigates the cause.",
      "# Roles and escalation",
      "Named roles: incident commander (Chief Information Security Officer), communications lead (Chief Compliance Officer), legal lead (Head of Legal), operations lead (Head of Operations). The escalation path runs from the security operations centre to the incident commander within 30 minutes, then to the Managing Director for high severity incidents.",
      "# Testing",
      "The plan is tested through a tabletop exercise every year. The last exercise was held in March 2026 and its lessons were added to this version.",
    ],
  },
  {
    file: "Breach_Notification_Procedure.docx", format: "docx", controls: ["BRE-02"], doctype: "Procedure", title: "Personal data breach notification procedure", date: "2026-02-15", owner: "Meera Kapoor, Chief Compliance Officer", role: "weak",
    description: "How the Board and affected clients are informed of a personal data breach.",
    lines: [
      ...pol("Personal Data Breach Notification Procedure", "Meera Kapoor, Chief Compliance Officer", "1.3", "the Chief Compliance Officer", "15 February 2026", "14 February 2027", "personal data breaches affecting clients, employees or partners."),
      "# Procedure",
      "A procedure to inform the Data Protection Board and affected data principals within the prescribed timelines. The Chief Compliance Officer decides whether a breach must be notified. The Board is informed through the prescribed form.",
      "# Draft templates",
      "A draft template for the notice to the Data Protection Board is attached as Annexure A. A template for affected clients is under preparation.",
    ],
  },
  {
    file: "Incident_Log_FY26.xlsx", format: "xlsx", controls: ["BRK-02", "CYB-01"], doctype: "Log", title: "Incident log and regulator report times FY26", date: "2026-09-21", owner: "Dev Malhotra, Chief Information Security Officer", role: "good",
    description: "Every incident with the time it was noticed and the time it was reported to SEBI, the exchange and CERT-In.",
    table: { intro: ["Incident log for FY26. Owner: Dev Malhotra, Chief Information Security Officer. Version 3.0, dated 21 September 2026. Approved by the Chief Information Security Officer.", "Cyber incidents and breaches are reported to SEBI and the exchange within six hours of noticing them, and to CERT-In within six hours, followed by a root cause analysis, with a record of every report. This log records every incident, the time it was noticed and the time it was reported. Scope: all incidents at Orchid Hill."], sheet: "Incident log", header: ["Incident", "Date", "Description", "Severity", "Personal data impact", "Noticed at", "Reported to SEBI, exchange and CERT-In at", "Hours to report", "Status"], rows: incidentRows },
  },
  {
    file: "Vendor_Management_Policy.docx", format: "docx", controls: ["PRO-02"], doctype: "Policy", title: "Vendor due diligence and monitoring policy", date: "2026-03-20", owner: "Vivek Bansal, Chief Risk Officer", role: "good",
    description: "Vendors are assessed before onboarding and re-assessed periodically.",
    lines: [
      ...pol("Vendor Due Diligence and Monitoring Policy", "Vivek Bansal, Chief Risk Officer", "2.0", "the Chief Risk Officer", "1 April 2026", "31 March 2027", "all vendors that handle personal data on behalf of Orchid Hill."),
      "# Before onboarding",
      "Vendors are assessed before onboarding. The assessment covers how the vendor handles personal data, where it is stored, security certifications, sub-vendors and breach history.",
      "# Monitoring",
      "Vendors are re-assessed periodically: critical vendors every year, others every two years. The re-assessment checks the vendor's current security posture and how it handles personal data. Results are kept in the vendor file.",
    ],
  },
  {
    file: "Vendor_Contract_Register.xlsx", format: "xlsx", controls: ["PRO-01"], doctype: "Agreement", title: "Vendor data protection contract register", date: "2026-09-10", owner: "Vivek Bansal, Chief Risk Officer", role: "weak",
    description: "Every vendor and the data protection terms in its contract.",
    table: { intro: ["Vendor data protection contract register. Owner: Vivek Bansal, Chief Risk Officer. Version 1.4, dated 10 September 2026. Approved by the Chief Risk Officer.", "Processors are engaged under a written contract that binds them to security, breach reporting, deletion and audit. This register lists each vendor and whether its contract has these terms. Scope: every vendor that handles personal data."], sheet: "Vendor contracts", header: ["Vendor", "Service", "Data shared", "Contract status", "Security terms", "Breach reporting terms", "Deletion on exit terms", "Country"], rows: vendorRows },
  },
  {
    file: "Data_Principal_Rights_SOP.docx", format: "docx", controls: ["RIG-01", "RIG-02"], doctype: "Procedure", title: "Data principal rights and grievance SOP", date: "2026-03-30", owner: "Kavita Deshmukh, Head of Customer Care", role: "good",
    description: "Process to receive, verify and answer rights requests and grievances within the prescribed time.",
    lines: [
      ...pol("Data Principal Rights and Grievance Redressal SOP", "Kavita Deshmukh, Head of Customer Care", "2.0", "the Chief Compliance Officer", "1 April 2026", "31 March 2027", "requests from clients, prospects and employees about their personal data."),
      "# Rights requests",
      "A process receives, verifies and answers requests to access, correct, complete, update or erase personal data within the prescribed time. Requests arrive through the app, email or branch. The identity of the requester is verified. The answer is sent within 30 days.",
      "# Grievance redressal and contact point",
      "A published contact for questions and grievances: privacy@orchidhill.example. Every grievance is tracked in SupportDesk with a response within the prescribed time. A nomination facility lets a client name a person to exercise their rights if they cannot.",
    ],
  },
  {
    file: "System_Audit_Report_FY25-26.pdf", format: "pdf", controls: ["BRK-03"], doctype: "Report", title: "System audit and cyber audit report FY25-26", date: "2026-05-30", owner: "Dev Malhotra, Chief Information Security Officer", role: "good",
    description: "System audit by an empanelled auditor covering cyber security, cloud, order management and risk systems.",
    lines: [
      "# System Audit and Cyber Audit Report FY2025-26",
      "Auditor: Brightline Assurance LLP, an auditor from the SEBI empanelled list. Report dated 30 May 2026. Signed by the lead auditor. Version 1.0. Scope: this system audit covers cyber security, cloud, order management and risk management systems of Orchid Hill Securities Limited.",
      "# Interval",
      "The system audit is done at the prescribed half-yearly interval by an auditor from the empanelled list. This report covers the period 1 October 2025 to 31 March 2026.",
      "# Findings",
      "15 findings were raised: 2 high, 6 medium and 7 low. Management responses were obtained. 14 of 15 findings were closed within the stated time. One low finding on log retention for a legacy server remains open with a due date of 30 November 2026. Findings are tracked and closed within the stated time.",
    ],
  },
  {
    file: "KYC_Data_Handling_Procedure.docx", format: "docx", controls: ["BRK-04"], doctype: "Procedure", title: "Client KYC data handling procedure", date: "2026-03-18", owner: "Nandini Rao, Head of Onboarding", role: "good",
    description: "How client identity documents are collected, uploaded to the KRA and stored.",
    lines: [
      ...pol("Client KYC Data Handling Procedure", "Nandini Rao, Head of Onboarding", "3.0", "the Chief Compliance Officer", "1 April 2026", "31 March 2027", "all client identity documents and KYC details."),
      "# Collection and KRA upload",
      "Client identity documents and KYC details are collected for the stated purpose only. KYC details are uploaded to the KYC Registration Agency within the prescribed time.",
      "# Storage",
      "KYC documents are stored encrypted with restricted access in the onboarding system. Only the onboarding and compliance teams can open them. Client KYC details are kept current: clients are asked to update them every two years and on any change.",
    ],
  },
  {
    file: "Mobile_App_Security_Standard.docx", format: "docx", controls: ["BRK-05", "BRK-09"], doctype: "Policy", title: "Trading app and portal security standard", date: "2026-03-18", owner: "Dev Malhotra, Chief Information Security Officer", role: "good",
    description: "Masking, encryption and authentication standards for the trading apps and portals.",
    lines: [
      ...pol("Trading App and Portal Security Standard", "Dev Malhotra, Chief Information Security Officer", "2.4", "the Chief Information Security Officer", "1 April 2026", "31 March 2027", "the OH Trade web and mobile apps, the Authorised Person Portal and the APIs."),
      "# Client data protection",
      "Client identifiers such as PAN, bank and demat details are masked in apps and statements and transmitted encrypted. They are exposed to staff and partners only on a need-to-know basis.",
      "# Authentication and API security",
      "Client logins use multi-factor authentication. Sessions expire after inactivity and API keys are protected and can be revoked on request. Algorithmic and API access is registered and monitored.",
    ],
  },
  {
    file: "Outsourcing_and_Cloud_Policy.docx", format: "docx", controls: ["BRK-06"], doctype: "Policy", title: "Outsourcing and cloud policy", date: "2026-03-18", owner: "Vivek Bansal, Chief Risk Officer", role: "good",
    description: "Due diligence, contract content and data location rules for outsourced and cloud services.",
    lines: [
      ...pol("Outsourcing and Cloud Policy", "Vivek Bansal, Chief Risk Officer", "2.0", "the Board Risk Committee", "1 April 2026", "31 March 2027", "all outsourced and cloud services that touch client data."),
      "# Due diligence, contract and data location",
      "Outsourced and cloud services that touch client data are chosen after due diligence. Each is covered by a written agreement on security, confidentiality, data location and regulator access. Client data stays in India. The service is monitored through quarterly reviews.",
    ],
  },
  {
    file: "Investor_Grievance_SOP.docx", format: "docx", controls: ["BRK-07"], doctype: "Procedure", title: "Investor grievance redressal SOP (SCORES and ODR)", date: "2026-03-18", owner: "Kavita Deshmukh, Head of Customer Care", role: "good",
    description: "Complaints from every channel are logged, answered through SCORES and escalated to ODR.",
    lines: [
      ...pol("Investor Grievance Redressal SOP", "Kavita Deshmukh, Head of Customer Care", "3.2", "the Chief Compliance Officer", "1 April 2026", "31 March 2027", "investor complaints received by any channel."),
      "# Handling",
      "Investor complaints from every channel are logged, answered through SCORES within the prescribed time, and escalated to online dispute resolution when unresolved.",
    ],
  },
  {
    file: "BCP_DR_Plan.docx", format: "docx", controls: ["BRK-08"], doctype: "Procedure", title: "Business continuity and disaster recovery plan", date: "2026-02-28", owner: "Sanjay Kulkarni, Head of Operations", role: "good",
    description: "Tested continuity and recovery plan for trading, back-office and client data systems.",
    lines: [
      ...pol("Business Continuity and Disaster Recovery Plan", "Sanjay Kulkarni, Head of Operations", "4.1", "the Board Risk Committee", "28 February 2026", "27 February 2027", "trading, back-office and client data systems."),
      "# Plan and drills",
      "Trading, back-office and client data systems have a tested business continuity and disaster recovery plan. Backups are protected and recovery drills are held at the prescribed interval. The last full recovery drill was held on 14 February 2026 and met the recovery time targets.",
    ],
  },
  {
    file: "Authorised_Person_Agreement_Template.docx", format: "docx", controls: ["BRK-10"], doctype: "Agreement", title: "Authorised person agreement (template)", date: "2026-01-12", owner: "Harish Pillai, Head of Business Development", role: "weak",
    description: "Standard agreement with authorised persons, including data confidentiality.",
    lines: [
      ...pol("Authorised Person Agreement", "Harish Pillai, Head of Business Development", "2.0", "the Head of Legal", "12 January 2026", "11 January 2027", "all authorised persons and referral partners."),
      "# Confidentiality",
      "The authorised person shall keep client information confidential and use it only to serve the clients referred by them. The authorised person shall not copy or share client data.",
    ],
  },
  {
    file: "AML_Policy_PMLA.docx", format: "docx", controls: ["BRK-12"], doctype: "Policy", title: "Anti-money laundering policy", date: "2026-03-10", owner: "Vivek Bansal, Chief Risk Officer", role: "good",
    description: "Board-approved AML policy covering due diligence, monitoring alerts and suspicious transaction reports.",
    lines: [
      ...pol("Anti-Money Laundering Policy", "Vivek Bansal, Chief Risk Officer and Principal Officer", "5.0", "the Board of Directors", "1 April 2026", "31 March 2027", "all clients, accounts and transactions."),
      "# Records and reporting",
      "Client due diligence records, monitoring alerts and suspicious transaction reports are maintained under this board-approved anti-money laundering policy. Access is limited to the compliance team. Suspicious transaction reports are filed with FIU-IND within the prescribed time.",
    ],
  },
  {
    file: "ICT_Log_Retention_Standard.docx", format: "docx", controls: ["CYB-02"], doctype: "Policy", title: "ICT log retention and time synchronisation standard", date: "2026-03-10", owner: "Dev Malhotra, Chief Information Security Officer", role: "good",
    description: "Logs kept 180 days within India; clocks synchronised to NIC or NPL.",
    lines: [
      ...pol("ICT Log Retention and Time Synchronisation Standard", "Dev Malhotra, Chief Information Security Officer", "1.4", "the Chief Information Security Officer", "1 April 2026", "31 March 2027", "all ICT systems of Orchid Hill."),
      "# Logs and clocks",
      "Logs of all ICT systems are enabled and kept for a rolling 180 days within India and can be produced to CERT-In. System clocks are synchronised to NIC or NPL time servers.",
    ],
  },
  {
    file: "Commercial_Communications_Policy.docx", format: "docx", controls: ["CYB-03"], doctype: "Policy", title: "Commercial communications consent and preference policy", date: "2026-03-10", owner: "Tanvi Arora, Head of Marketing", role: "good",
    description: "Promotional calls and messages use registered headers, respect DND and are backed by a consent register.",
    lines: [
      ...pol("Commercial Communications Policy", "Tanvi Arora, Head of Marketing", "1.2", "the Chief Compliance Officer", "1 April 2026", "31 March 2027", "promotional calls, SMS and emails."),
      "# Rules",
      "Promotional calls and messages use registered headers and templates, respect customer Do Not Disturb preferences and are backed by a consent register.",
    ],
  },
  {
    file: "Client_Data_Update_Procedure.docx", format: "docx", controls: ["ACC-01"], doctype: "Procedure", title: "Client data accuracy and update procedure", date: "2026-03-10", owner: "Nandini Rao, Head of Onboarding", role: "good",
    description: "Client data used for decisions or shared is kept reasonably accurate and complete.",
    lines: [
      ...pol("Client Data Accuracy and Update Procedure", "Nandini Rao, Head of Onboarding", "1.1", "the Head of Operations", "1 April 2026", "31 March 2027", "client data that is used to decide about a client or shared outside Orchid Hill."),
      "# Accuracy",
      "Where personal data is used to decide about a client or shared, it is kept reasonably accurate and complete. Clients can update their details in the app. Returned mail and bounced emails trigger a data update request.",
    ],
  },
  // ----- deliberately imperfect uploads -----
  {
    file: "Privacy_Policy_v4_DRAFT.docx", format: "docx", controls: ["GOV-02"], doctype: "Policy", title: "Privacy policy v4 (draft)", date: "2026-09-18", owner: "Meera Kapoor, Chief Compliance Officer", role: "draft",
    description: "Draft of the next privacy policy version, not yet approved.",
    lines: [
      "# Privacy Policy (DRAFT for discussion)",
      "Orchid Hill. DRAFT. This text is a working draft and has not been circulated. Sections are incomplete. Comments from Legal are pending.",
      "The privacy policy will describe how personal data is collected and used. Details to be added.",
    ],
  },
  {
    file: "Board_Resolution_Scan.png", format: "png", controls: ["GOV-01"], doctype: "Certificate", title: "Board resolution on privacy governance (scan)", date: "2026-03-28", owner: "Meera Kapoor, Chief Compliance Officer", role: "unreadable",
    description: "Scanned copy of the Board resolution appointing the privacy owner. Image only.",
  },
  {
    file: "Canteen_Menu_Week42.txt", format: "txt", controls: ["SEC-01"], doctype: "Other", title: "Security evidence", date: "2026-09-14", owner: "Gopal Nair, Head of Administration", role: "irrelevant",
    description: "Uploaded by mistake against the security control.",
    lines: ["Canteen menu for the week. Monday: vegetable biryani, dal tadka, curd rice, fresh fruit. Tuesday: rajma chawal, paneer butter masala, jeera rice, salad. Wednesday: chole bhature, aloo gobi, raita, sweet. Thursday: sambar rice, poriyal, papad, buttermilk. Friday: veg pulao, mixed dal, roti, kheer. Please return trays to the counter after lunch. The cafeteria is open from noon to three.", "Week 43. Monday: idli, sambar and chutney, upma. Tuesday: poha, masala tea, fruit. Wednesday: aloo paratha, curd, pickle. Thursday: dosa with potato masala, filter coffee. Friday: bisi bele bath, boondi raita, papad. All items are cooked fresh each morning by the canteen contractor, and menus may change with the availability of vegetables.", "Week 44. Monday: chapati, mixed vegetable curry, dal fry, rice, salad. Tuesday: lemon rice, sambar, curd, fried papad. Wednesday: pav bhaji, onion salad, buttermilk. Thursday: jeera rice, rajma, raita. Friday: fried rice, manchurian, soup. The canteen will remain closed on public holidays and during the annual maintenance shutdown of the dining hall.", "Notice to all staff. Please keep the dining hall clean, return trays after meals and do not take crockery out of the canteen. Lost property is kept at the reception for one week. The canteen committee meets on the first Monday of every month to discuss food quality, hygiene and prices, and every employee is welcome to attend.", "Saturday: half day. Special lunch with puri, sabzi and shrikhand. Sunday: closed. The canteen contractor will update the menu next week and welcomes feedback on the food quality, portion size and cleanliness of the dining hall."],
  },
  {
    file: "Network_Penetration_Test_Report.pdf", format: "pdf", controls: ["SEC-01"], doctype: "Report", title: "Network penetration test report", date: "2026-08-12", owner: "Dev Malhotra, Chief Information Security Officer", role: "not_uploaded",
    description: "Penetration test of the trading platform. Listed in the index but the file was not uploaded.",
  },
  {
    file: "Branch_Visit_Notes.txt", format: "txt", controls: [], doctype: "Other", title: "Branch visit notes", date: "2026-09-02", owner: "Harish Pillai, Head of Business Development", role: "not_indexed",
    description: "Uploaded but not listed in the Evidence Index.",
    lines: ["Visit to the Pune branch on 2 September. The branch keeps paper account-opening forms in an unlocked cabinet near reception. Staff said forms are sent to the archive vendor monthly."],
  },
];

// ------------------------------------------------------------------ support documents
export const SCOPE_SUPPORT: DocSpec[] = [
  {
    file: "SEBI_Registration_Certificates.pdf", format: "pdf", controls: [], doctype: "Certificate", title: "SEBI registration certificates", date: "2024-01-15", owner: "Meera Kapoor", role: "good", description: "Registration certificates as supplied.",
    lines: ["# Registration Certificates held by Orchid Hill Securities Limited", "Securities and Exchange Board of India: Certificate of Registration as Stock Broker, registration number INZ000DEMO01, effective from 2010 and valid until suspended or cancelled.", "Securities and Exchange Board of India: Certificate of Registration as Depository Participant with Central Depository Services (India) Limited, registration number IN-DP-DEMO-001.", "Securities and Exchange Board of India: Certificate of Registration as Research Analyst, registration number INH000DEMO02.", "National Stock Exchange of India and BSE: membership as trading and clearing member, TM-DEMO-90001."],
  },
  {
    file: "Organisation_Chart.docx", format: "docx", controls: [], doctype: "Other", title: "Organisation chart", date: "2026-08-01", owner: "Leena Thomas", role: "good", description: "Who reports to whom.",
    lines: ["# Orchid Hill Securities Limited: organisation chart", "Board of Directors. Managing Director and CEO: Rajiv Sinha. Chief Compliance Officer: Meera Kapoor. Chief Information Security Officer: Dev Malhotra. Chief Risk Officer: Vivek Bansal.", "Business units: Client Onboarding and KYC, Trading Operations, Depository Operations, Risk Management and Surveillance, Technology and Information Security, Customer Support and Grievances, Authorised Persons Network, Marketing and Research, Human Resources, Facilities and Administration.", "Group companies: Orchid Hill Finserv Limited, a non-banking financial company that provides margin funding and loans against shares; Orchid Hill Wealth Advisors LLP, which distributes mutual funds."],
  },
];
export const INVENTORY_SUPPORT: DocSpec[] = [
  {
    file: "Vendor_Master_List.xlsx", format: "xlsx", controls: [], doctype: "Other", title: "Vendor master list", date: "2026-08-20", owner: "Vivek Bansal", role: "good", description: "Procurement's list of all vendors.",
    table: { sheet: "Vendors", header: ["Vendor", "Category", "Annual spend (₹ lakh)", "Owner", "Contract end"], rows: vendorRows.map((v, i) => [v[0] as string, v[1] as string, 8 + i * 6, DEPTS[i % DEPTS.length]!, day("2027-03-31", i * 30)]) },
  },
];
