// Orchid Hill Securities Limited: an INVENTED stock broker and depository participant used to demonstrate
// the platform from the first upload to the final report. Every name, number and figure is fictional.
// Pure data (no database, no server code) so the pack builder, the seed and the tests all share it.
import type { Filled } from "@/lib/templates/build";
import { TEMPLATES, practiceRows } from "@/lib/templates/definitions";

export const FIRM = {
  name: "Orchid Hill Securities Limited",
  industry: "Stock broking and depository participant",
  hq: "Mumbai",
  engagement: "Orchid Hill: live end-to-end demo FY2026-27",
  domain: "orchidhill.example",
  team: [
    { name: "Meera Kapoor", email: "meera.kapoor@orchidhill.example", org: "Client Administrator", title: "Chief Compliance Officer" },
    { name: "Dev Malhotra", email: "dev.malhotra@orchidhill.example", org: "Privacy Officer", title: "Chief Information Security Officer" },
    { name: "Rajiv Sinha", email: "rajiv.sinha@orchidhill.example", org: "CXO / Executive Viewer", title: "Managing Director and CEO" },
  ],
} as const;

// ------------------------------------------------------------------ phase 1
export const SCOPE_FILLED: Filled = {
  forms: {
    Organisation: {
      "O-01": { answer: "Orchid Hill Securities Limited" },
      "O-02": { answer: "U67120MH2009PLC000000", notes: "Fictional number for the demo" },
      "O-03": { answer: "Public limited" },
      "O-04": { answer: 2009 },
      "O-05": { answer: "Mumbai" },
      "O-06": { answer: "www.orchidhill.example" },
      "O-07": { answer: 642 },
      "O-08": { answer: 1425000, notes: "Active and dormant trading and demat accounts" },
      "O-09": { answer: 468 },
      "O-10": { answer: 38 },
      "O-11": { answer: 410, notes: "Authorised persons registered with the exchanges" },
      "O-12": { answer: "Orchid Hill Finserv Limited (NBFC: margin funding and loans against shares); Orchid Hill Wealth Advisors LLP (mutual fund distribution)" },
      "O-13": { answer: "Orchid Hill is a stock broker and depository participant. It offers online and assisted trading in equities, derivatives and commodities, demat accounts (including accounts for minors), research reports and investor services through 38 branches and 410 authorised persons." },
      "O-14": { answer: "Meera Kapoor, Chief Compliance Officer, meera.kapoor@orchidhill.example" },
      "O-15": { answer: "" },
    },
  },
  tables: {
    Registrations: [
      { registration: "Stock Broker (equity, derivatives, commodity derivatives)", regulator: "SEBI", number: "INZ000DEMO01", status: "Active" },
      { registration: "Depository Participant", regulator: "SEBI (with CDSL)", number: "IN-DP-DEMO-001", status: "Active" },
      { registration: "Research Analyst", regulator: "SEBI", number: "INH000DEMO02", status: "Active" },
      { registration: "Trading and clearing member (equity and derivatives)", regulator: "NSE and BSE", number: "TM-DEMO-90001", status: "Active" },
      { registration: "Portfolio Manager", regulator: "SEBI", number: "Applied June 2026", status: "Applied" },
      { registration: "Mutual fund distributor (ARN)", regulator: "AMFI", number: "ARN-DEMO-0000", status: "Lapsed" },
    ],
    "Business units": [
      { name: "Client Onboarding and KYC", does: "Opens trading and demat accounts, verifies identity, uploads KYC records to the KRA", head: "Nandini Rao, Head of Onboarding", personal: "Yes", staff: 74 },
      { name: "Trading Operations", does: "Order handling, trade confirmation, funds and securities settlement", head: "Sanjay Kulkarni, Head of Operations", personal: "Yes", staff: 96 },
      { name: "Depository Operations", does: "Demat account maintenance, transfers, pledges, nominations", head: "Farah Qureshi, Head of DP Operations", personal: "Yes", staff: 41 },
      { name: "Risk Management and Surveillance", does: "Margin and exposure monitoring, trade surveillance, anti-money-laundering alerts", head: "Vivek Bansal, Chief Risk Officer", personal: "Yes", staff: 33 },
      { name: "Technology and Information Security", does: "Runs the trading platform, apps and infrastructure; security monitoring", head: "Dev Malhotra, Chief Information Security Officer", personal: "Yes", staff: 88 },
      { name: "Customer Support and Grievances", does: "Phone, chat and email support; investor complaints including SCORES", head: "Kavita Deshmukh, Head of Customer Care", personal: "Yes", staff: 112 },
      { name: "Authorised Persons Network", does: "Onboards, trains and supervises authorised persons and referral partners", head: "Harish Pillai, Head of Business Development", personal: "Yes", staff: 27 },
      { name: "Marketing and Research", does: "Campaigns, lead generation, research reports and investor education", head: "Tanvi Arora, Head of Marketing", personal: "Yes", staff: 29 },
      { name: "Human Resources", does: "Hiring, payroll, attendance and employee records", head: "Leena Thomas, Head of HR", personal: "Yes", staff: 18 },
      { name: "Facilities and Administration", does: "Premises, travel and office supplies", head: "Gopal Nair, Head of Administration", personal: "No", staff: 24 },
    ],
    Systems: [
      { system: "OH Trade (web and mobile trading platform)", purpose: "Client trading, orders, portfolio view", hosting: "CloudNine Hosting (Mumbai region)", client_data: "Yes" },
      { system: "ClientSphere Back Office", purpose: "Client ledger, contract notes, settlement and billing", hosting: "Own data centre, Navi Mumbai", client_data: "Yes" },
      { system: "DP Core (depository system)", purpose: "Demat accounts, holdings, transfers", hosting: "Own data centre, Navi Mumbai", client_data: "Yes" },
      { system: "OH Onboard (KYC portal)", purpose: "Account opening, eKYC, eSign, document storage", hosting: "CloudNine Hosting (Mumbai region)", client_data: "Yes" },
      { system: "SupportDesk CRM", purpose: "Support tickets, consent register, leads", hosting: "CloudNine Hosting (Mumbai region)", client_data: "Yes" },
      { system: "Risk and Surveillance Engine", purpose: "Margin monitoring, surveillance and AML alerts", hosting: "Own data centre, Navi Mumbai", client_data: "Yes" },
      { system: "Authorised Person Portal", purpose: "Partner dashboard of referred clients and brokerage", hosting: "CloudNine Hosting (Mumbai region)", client_data: "Yes" },
      { system: "PeopleDesk HRMS", purpose: "Employee records and payroll", hosting: "PeopleDesk Cloud", client_data: "No" },
    ],
  },
};

// ------------------------------------------------------------------ phase 2
export const INVENTORY_FILLED: Filled = {
  tables: {
    "Processing activities": [
      { activity: "Client onboarding and KYC", unit: "Client Onboarding and KYC", purpose: "Verify identity and open trading and demat accounts as SEBI and PMLA require", principals: "Prospective clients; Clients; Minor clients and their guardians", elements: "Name; PAN; Aadhaar (masked); Date of birth; Address; Mobile number; Email; Photograph; Signature; Bank account number; Income details", systems: "OH Onboard (KYC portal); ClientSphere Back Office; DP Core (depository system)", vendors: "Sahi eSign Technologies; KYCBridge Solutions; CloudNine Hosting", basis: "Legal obligation", retention: "8 years after the account is closed (PMLA and SEBI)", abroad: "No" },
      { activity: "Order execution and trade settlement", unit: "Trading Operations", purpose: "Execute client orders and settle trades with the exchanges", principals: "Clients", elements: "Name; PAN; Bank account number; Trading and holding data; Order history; IP address; Device identifier", systems: "OH Trade (web and mobile trading platform); ClientSphere Back Office", vendors: "CloudNine Hosting; PayLink Gateway", basis: "Legal obligation", retention: "8 years (SEBI and exchange rules)", abroad: "No" },
      { activity: "Demat account operations", unit: "Depository Operations", purpose: "Maintain demat accounts and process transfers, pledges and nominations", principals: "Clients; Nominees; Minor clients and their guardians", elements: "Name; PAN; Demat account number; Nominee details; Trading and holding data; Signature", systems: "DP Core (depository system)", vendors: "Central Depository (CDSL)", basis: "Legal obligation", retention: "8 years after the account is closed", abroad: "No" },
      { activity: "Margin and risk monitoring", unit: "Risk Management and Surveillance", purpose: "Set trading limits and watch margin and unusual activity", principals: "Clients", elements: "Trading and holding data; Income details; Bank account number; Order history", systems: "Risk and Surveillance Engine; ClientSphere Back Office", vendors: "", basis: "Legal obligation", retention: "8 years", abroad: "No" },
      { activity: "Anti-money-laundering monitoring", unit: "Risk Management and Surveillance", purpose: "Detect suspicious transactions and file reports with FIU-IND", principals: "Clients", elements: "Name; PAN; Trading and holding data; Bank account number; Income details; Alert notes", systems: "Risk and Surveillance Engine", vendors: "", basis: "Legal obligation", retention: "5 years after the relationship ends (PMLA)", abroad: "No" },
      { activity: "Customer support and investor grievances", unit: "Customer Support and Grievances", purpose: "Answer queries and complaints, including those raised on SCORES", principals: "Clients; Prospective clients", elements: "Name; Mobile number; Email; Call recordings; Complaint details; Client code", systems: "SupportDesk CRM", vendors: "CallVault Recorder; PingWave SMS", basis: "Legal obligation", retention: "5 years; call recordings 2 years", abroad: "No" },
      { activity: "Marketing and lead generation", unit: "Marketing and Research", purpose: "Promote services to prospects and clients and send research reports", principals: "Prospective clients; Website visitors; Clients", elements: "Name; Mobile number; Email; Device identifier; IP address; App usage data", systems: "SupportDesk CRM", vendors: "MailForge Email Services; PingWave SMS", basis: "Consent", retention: "Not defined", abroad: "No" },
      { activity: "Authorised person management", unit: "Authorised Persons Network", purpose: "Onboard and supervise authorised persons who refer and serve clients", principals: "Authorised persons and their staff; Clients referred by partners", elements: "Name; PAN; Mobile number; Email; Bank account number; Client lists assigned", systems: "Authorised Person Portal; ClientSphere Back Office", vendors: "CloudNine Hosting", basis: "Legal obligation", retention: "5 years after the partner leaves", abroad: "No" },
      { activity: "Employee records and payroll", unit: "Human Resources", purpose: "Hire, pay and manage staff", principals: "Employees; Job candidates", elements: "Name; Aadhaar (masked); PAN; Bank account number; Salary; Date of birth; Address; Attendance; Resume", systems: "PeopleDesk HRMS", vendors: "PeopleDesk Cloud", basis: "Employment", retention: "8 years after the employee leaves", abroad: "No" },
      { activity: "App and web analytics", unit: "Technology and Information Security", purpose: "Keep the apps working, prevent fraud and measure usage", principals: "Clients; Website visitors", elements: "Device identifier; IP address; App usage data; Location (city)", systems: "OH Trade (web and mobile trading platform)", vendors: "InsightLoop Analytics", basis: "Consent", retention: "26 months", abroad: "Yes" },
      { activity: "Recorded communications archive", unit: "Technology and Information Security", purpose: "Keep communications with clients as SEBI requires", principals: "Clients; Employees", elements: "Name; Email; Call recordings; Message content", systems: "SupportDesk CRM", vendors: "MailForge Email Services; CallVault Recorder", basis: "Legal obligation", retention: "8 years", abroad: "No" },
      { activity: "Group sharing for margin funding offers", unit: "Marketing and Research", purpose: "Offer margin funding and loans against shares from the group NBFC", principals: "Clients", elements: "Name; PAN; Mobile number; Trading and holding data", systems: "SupportDesk CRM; ClientSphere Back Office", vendors: "", basis: "Consent", retention: "Until consent is withdrawn", abroad: "No" },
    ],
    "Systems and data stores": [
      { system: "OH Trade (web and mobile trading platform)", store: "Trading database (PostgreSQL)", hosting: "Cloud (India)", owner: "Head of Trading Technology" },
      { system: "ClientSphere Back Office", store: "Back-office database (Oracle)", hosting: "On-premise", owner: "Head of Operations" },
      { system: "DP Core (depository system)", store: "Depository records", hosting: "On-premise", owner: "Head of DP Operations" },
      { system: "OH Onboard (KYC portal)", store: "KYC document store (object storage)", hosting: "Cloud (India)", owner: "Head of Onboarding" },
      { system: "SupportDesk CRM", store: "CRM database and consent register", hosting: "Cloud (India)", owner: "Head of Customer Care" },
      { system: "Risk and Surveillance Engine", store: "Surveillance database", hosting: "On-premise", owner: "Chief Risk Officer" },
      { system: "Authorised Person Portal", store: "Partner and referred-client tables", hosting: "Cloud (India)", owner: "Head of Business Development" },
      { system: "PeopleDesk HRMS", store: "HR database (vendor hosted)", hosting: "Cloud (India)", owner: "Head of HR" },
      { system: "InsightLoop Analytics", store: "Event store (vendor hosted)", hosting: "Cloud (outside India)", owner: "Head of Marketing" },
      { system: "Branch file servers", store: "Scanned account-opening forms", hosting: "On-premise", owner: "Head of Administration" },
    ],
    Vendors: [
      { vendor: "CloudNine Hosting", service: "Cloud infrastructure for trading, KYC and CRM", data: "All client data held in OH Trade, OH Onboard and SupportDesk CRM", contract: "Yes", country: "India" },
      { vendor: "Sahi eSign Technologies", service: "Aadhaar-based eSign and eKYC", data: "Name, masked Aadhaar, signature, mobile number", contract: "Yes", country: "India" },
      { vendor: "KYCBridge Solutions", service: "Document and face verification", data: "PAN, photograph, address proof", contract: "Partly", country: "India" },
      { vendor: "PingWave SMS", service: "OTP and promotional messages", data: "Mobile numbers, message content", contract: "No", country: "India" },
      { vendor: "MailForge Email Services", service: "Email delivery and archive", data: "Names, email addresses, statements as attachments", contract: "Partly", country: "India" },
      { vendor: "CallVault Recorder", service: "Call recording and storage", data: "Voice recordings, client codes", contract: "Yes", country: "India" },
      { vendor: "InsightLoop Analytics", service: "App and web analytics", data: "Device identifiers, IP addresses, app usage", contract: "No", country: "Singapore" },
      { vendor: "PeopleDesk Cloud", service: "HR and payroll software", data: "Employee records", contract: "Yes", country: "India" },
      { vendor: "Central Depository (CDSL)", service: "Depository services", data: "Demat account and holding data", contract: "Yes", country: "India" },
      { vendor: "PayLink Gateway", service: "Fund transfer and payment collection", data: "Bank account details, amounts", contract: "Yes", country: "India" },
      { vendor: "DocuVault Archival", service: "Off-site storage of paper forms", data: "Scanned and paper account-opening forms", contract: "No", country: "India" },
    ],
  },
  forms: {
    Practices: (() => {
      const A: Record<string, [string, string?]> = {
        "governance.owner": ["Meera Kapoor, Chief Compliance Officer", "Privacy_Policy_v3.docx"],
        "governance.dpo": ["No"],
        "governance.policy": ["Yes", "Privacy_Policy_v3.docx"],
        "governance.training": ["Yes", "Training_Attendance_FY26.xlsx"],
        "governance.oversight": ["Not sure"],
        "rights.rights_process": ["Yes", "Data_Principal_Rights_SOP.docx"],
        "rights.grievance": ["Yes", "Data_Principal_Rights_SOP.docx"],
        "rights.nominee": ["No"],
        "rights.volume": ["10 to 100"],
        "incidents.breach_plan": ["Yes", "Incident_Response_Plan.docx"],
        "incidents.incident_log": ["Yes", "Incident_Log_FY26.xlsx"],
        "incidents.cert_in": ["Yes", "Incident_Log_FY26.xlsx"],
        "incidents.past_breaches": ["One incident in March 2025: a referral partner lost a laptop holding KYC copies of 212 clients. It was reported to SEBI and CERT-In within six hours and the clients were informed."],
        "lifecycle.collection": ["Account opening on the app and website with eKYC through Aadhaar OTP and DigiLocker, in-person verification at branches, and recorded calls."],
        "lifecycle.sharing": ["Exchanges, the depository (CDSL), the KYC registration agency, the clearing corporation, the group NBFC (with consent) and eleven vendors."],
        "lifecycle.retention_schedule": ["Yes", "Data_Retention_and_Erasure_Schedule.docx"],
        "lifecycle.erasure_process": ["Not sure"],
        "consent.relies_on_consent": ["Yes"],
        "consent.consent_how": ["Tick box in the app and website with timestamp, stored in the SupportDesk CRM consent register."],
        "consent.withdrawal": ["Not sure"],
        "consent.notice": ["Yes", "Privacy_Notice_Client_Onboarding.pdf"],
        "consent.legitimate_uses": ["Yes"],
        "vendors.contracts": ["Some"],
        "data_categories.children_data": ["Yes"],
        "data_categories.large_volume": ["Yes"],
        "processing_activities.automated_decisions": ["Yes"],
        "systems.cloud": ["Yes"],
        "systems.integrations": ["Exchange gateways, CDSL, KRA, payment gateway, WhatsApp business API, SMS gateway."],
        "sector.sdf": ["Not sure"],
        "sector.other_regulators": ["SEBI, NSE, BSE, CDSL, FIU-IND under PMLA, CERT-In."],
      };
      const out: NonNullable<Filled["forms"]>[string] = {};
      for (const r of practiceRows()) {
        const a = A[r.key];
        if (a) out[r.ref] = { answer: a[0], document: a[1] ?? null };
      }
      return out;
    })(),
  },
};

// ------------------------------------------------------------------ phase 4
const T = (control: string, procedure: string, sample: string, result: "Pass" | "Fail" | "Exception", date: string, notes: string) => ({ control, procedure, sample, result, date, tester: "Arjun Mehta (Primus consultant)", notes });
export const TESTS_FILLED: Filled = {
  tables: {
    Tests: [
      T("GOV-02", "Read the privacy policy and checked approval, owner, version and review date.", "Privacy Policy v3.0", "Pass", "2026-09-07", "Approved by the Board on 28 March 2026. Owner named."),
      T("GOV-03", "Compared the training register with the staff list.", "40 of 642 staff, picked at random", "Exception", "2026-09-08", "11 of 40 had no record of training this year (73% completion overall per the register)."),
      T("NOT-01", "Walked through account opening on the app and compared the notice shown with the policy.", "3 account openings", "Pass", "2026-09-08", "Notice shown before data is collected; contact for grievances present."),
      T("NOT-02", "Checked which languages the notice is available in.", "App, website and branch forms", "Fail", "2026-09-08", "English only. The notice is not offered in Hindi, Marathi or other languages used by clients."),
      T("CON-01", "Reviewed consent screens and the consent register entries.", "25 consents recorded in September", "Pass", "2026-09-09", "Consent is unbundled and recorded with timestamp and notice version."),
      T("CON-02", "Tried to withdraw consent for marketing messages through the app.", "5 withdrawal attempts", "Fail", "2026-09-09", "Withdrawal needs an email to the branch. No in-app option. Two requests were not actioned in 5 days."),
      T("SEC-02", "Checked user access reviews and leavers' access removal.", "Q1 to Q3 reviews; 25 leavers", "Fail", "2026-09-10", "No access review was done for two of three quarters. 9 of 25 leavers still had active accounts after 30 days."),
      T("BRE-01", "Read the incident response plan and the last tabletop exercise.", "Plan v2.2 and the March 2026 exercise", "Pass", "2026-09-10", "Roles named; exercise held in March 2026."),
      T("BRE-02", "Checked the breach notification procedure and templates.", "Procedure and 2 templates", "Exception", "2026-09-10", "Board notice template exists. No template for informing affected data principals."),
      T("PRO-01", "Checked vendor contracts for data protection terms.", "All 11 vendors", "Exception", "2026-09-11", "7 of 11 vendors have a full data processing agreement. PingWave SMS, InsightLoop Analytics and DocuVault Archival have none."),
      T("CHI-01", "Tested guardian verification when opening a minor's demat account.", "20 minor accounts opened this year", "Fail", "2026-09-11", "For 14 of 20, no proof that the guardian gave consent or that the guardian is the parent."),
      T("XBR-01", "Checked the list of transfers outside India.", "Vendor list and system list", "Fail", "2026-09-11", "InsightLoop Analytics (Singapore) receives device and usage data. It is not on any transfer register and was never reviewed."),
      T("RET-01", "Compared the retention schedule with actual deletion.", "Schedule v2 and 3 data sets", "Exception", "2026-09-14", "KYC and trade records follow the schedule. Marketing leads have no period and go back to 2019."),
      T("RIG-01", "Followed 10 rights requests from receipt to answer.", "10 requests in the last 6 months", "Pass", "2026-09-14", "All answered inside 30 days with identity checked."),
      T("RIG-02", "Checked the grievance contact and tracking.", "Website, app and 10 complaints", "Pass", "2026-09-14", "Contact published; complaints tracked in SupportDesk."),
      T("BRK-01", "Reviewed the cyber resilience policy and CISO appointment against SEBI's framework.", "Policy v4 and board minutes", "Pass", "2026-09-15", "Board approved; CISO appointed."),
      T("BRK-02", "Checked incident reports to SEBI and the exchange for timeliness.", "All 14 incidents in FY26", "Exception", "2026-09-15", "13 reported within six hours. One was reported after nine hours (INC-2026-07)."),
      T("BRK-03", "Read the latest system audit report and the closure of its findings.", "System audit FY25-26", "Pass", "2026-09-15", "Auditor is on the empanelled list. 14 of 15 findings closed."),
      T("BRK-05", "Checked masking of PAN, bank and demat details in the apps and the partner portal.", "App, statements, Authorised Person Portal", "Exception", "2026-09-16", "Masked in the app. The partner portal shows full PAN to every authorised person."),
      T("BRK-09", "Tested login, session and API key controls on the trading platform.", "Platform and 6 API users", "Pass", "2026-09-16", "Multi-factor login enforced; API keys revocable."),
      T("BRK-10", "Reviewed what authorised persons can see and how often access is reviewed.", "10 of 410 authorised persons", "Fail", "2026-09-16", "Each authorised person can see all their referred clients' full profile. No access log review in 12 months."),
      T("BRK-11", "Compared retention of client records, order logs and recordings with the legal periods.", "Schedule v2 and 3 data sets", "Pass", "2026-09-17", "Periods match SEBI, exchange and PMLA rules."),
      T("BRK-12", "Checked the AML policy, alerts and a sample of suspicious transaction reports.", "Policy, 20 alerts, 3 STRs", "Pass", "2026-09-17", "Board approved; reports filed on time."),
      T("CYB-01", "Checked the procedure for reporting incidents to CERT-In in six hours.", "Procedure and incident log", "Pass", "2026-09-17", "Procedure exists and was followed in the March 2025 incident."),
    ],
  },
};
void TEMPLATES;
