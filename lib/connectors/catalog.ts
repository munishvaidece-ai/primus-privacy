// The connector catalogue shown on the portal. Pure data (safe to import in
// screens). Status is deliberately honest:
//   "available" = built AND tested in this release (see tests/connectors).
//   "planned"   = listed so the client can see the roadmap; cannot be
//                 configured or run yet. Nothing here pretends otherwise.
// What every connector may keep: METADATA ONLY (names, locations, the
// categories of personal data seen, counts). Never copies of the data.

export type ConnectorStatus = "available" | "planned";
export type ConnectorCategory =
  | "Documents & files"
  | "Databases & data stores"
  | "Websites & apps"
  | "Cloud & infrastructure"
  | "Identity & access"
  | "Business applications"
  | "Security monitoring"
  | "Governance & tickets";

export interface FieldDef {
  key: string;
  label: string;
  help: string;
  placeholder?: string;
  kind: "text" | "number" | "textarea" | "password";
  required?: boolean;
}

export interface ConnectorDef {
  type: string;
  name: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  summary: string;
  /** What it looks at, in plain words. */
  reads: string;
  /** What the platform keeps. */
  keeps: string;
  /** Where the scan runs. */
  runsWhere: string;
  /** How it was verified (available) or what is needed (planned). */
  verification: string;
  configFields: FieldDef[];
  secretFields: FieldDef[];
  /** Built into the platform; nothing to configure. */
  native?: boolean;
}

const META_ONLY = "Names, locations and the categories of personal data seen, with counts. Never the personal data itself.";

export const CONNECTORS: ConnectorDef[] = [
  {
    type: "document_upload",
    name: "Document upload",
    category: "Documents & files",
    status: "available",
    native: true,
    summary: "Upload policies, contracts, screenshots, logs and registers straight into an engagement.",
    reads: "Only the files your team uploads.",
    keeps: "The uploaded files in the engagement's evidence store, with AI review notes.",
    runsWhere: "On the platform.",
    verification: "Built in and tested end to end: upload, text reading (text, Word, Excel, PDF, web pages), AI review, accept / reject.",
    configFields: [],
    secretFields: [],
  },
  {
    type: "document_folder",
    name: "Folder / file share scan",
    category: "Documents & files",
    status: "available",
    summary: "Scans a folder or network share that is mounted where the worker runs, and records which files hold personal data.",
    reads: "File names, sizes, dates and the text inside readable files (text, Word, Excel, PDF, web pages) — read in memory only.",
    keeps: META_ONLY,
    runsWhere: "Where the worker runs. Deploy the worker inside the client's environment so files never leave it.",
    verification: "Tested against real folders containing text, Word, Excel and PDF files, including path-escape and symlink checks.",
    configFields: [
      { key: "path", label: "Folder path", help: "Absolute path of the mounted folder. It must sit under an allowed root set by your devops team (CONNECTOR_FOLDER_ROOTS).", placeholder: "/mnt/client-share/hr", kind: "text", required: true },
      { key: "maxFiles", label: "Maximum files per scan", help: "Safety limit. Default 500.", placeholder: "500", kind: "number" },
    ],
    secretFields: [],
  },
  {
    type: "postgres_database",
    name: "PostgreSQL database scan",
    category: "Databases & data stores",
    status: "available",
    summary: "Reads a database's structure and finds which tables and columns hold personal data (names, emails, Aadhaar, PAN, phone numbers…).",
    reads: "Table and column names and types; optionally a small in-memory sample of values to recognise identifiers. Connection is read-only.",
    keeps: META_ONLY + " Sample values are discarded immediately.",
    runsWhere: "Where the worker runs — it needs network access to the database.",
    verification: "Tested against a real PostgreSQL database with seeded personal data, including read-only enforcement and a no-values-stored check.",
    configFields: [
      { key: "schemas", label: "Schemas to scan", help: "Comma-separated. Leave blank for all non-system schemas.", placeholder: "public, crm", kind: "text" },
      { key: "sampleRows", label: "Rows sampled per table", help: "0 = look at column names only. Default 50. Values are examined in memory and never stored.", placeholder: "50", kind: "number" },
    ],
    secretFields: [
      { key: "connectionString", label: "Connection string", help: "postgres://user:password@host:5432/dbname — use a read-only account. Stored encrypted.", placeholder: "postgres://readonly:…@db.client.local:5432/app", kind: "password", required: true },
    ],
  },
  {
    type: "website_scanner",
    name: "Website privacy & consent scan",
    category: "Websites & apps",
    status: "available",
    summary: "Checks a public website for a privacy notice, cookie consent, trackers, forms that collect personal data, and cookie / security-header hygiene.",
    reads: "The pages' public HTML and response headers — what any visitor's browser receives.",
    keeps: "Page addresses, the forms and cookies found (names only), tracker names, and plain-language observations.",
    runsWhere: "Where the worker runs. By default it refuses private / internal addresses.",
    verification: "Tested against a local test website with and without a cookie banner, trackers, pre-ticked consent and insecure cookies.",
    configFields: [
      { key: "url", label: "Website address", help: "Start page, e.g. https://www.client.com", placeholder: "https://www.client.com", kind: "text", required: true },
      { key: "maxPages", label: "Maximum pages", help: "Start page plus linked privacy / contact / sign-up pages. Default 5.", placeholder: "5", kind: "number" },
    ],
    secretFields: [],
  },

  // ---------------------------------------------------------------- planned
  { type: "sharepoint_onedrive", name: "SharePoint / OneDrive", category: "Documents & files", status: "planned", summary: "Scan Microsoft 365 document libraries for personal data.", reads: "Document libraries (via Microsoft Graph).", keeps: META_ONLY, runsWhere: "Worker, using a client-approved app registration.", verification: "Not built yet. Needs a Microsoft 365 tenant and an approved app registration to build and test. Until then, mount a synced copy and use the folder scan.", configFields: [], secretFields: [] },
  { type: "google_drive", name: "Google Drive / Workspace", category: "Documents & files", status: "planned", summary: "Scan shared drives for personal data.", reads: "Shared drives (via Google APIs).", keeps: META_ONLY, runsWhere: "Worker, using a client-approved service account.", verification: "Not built yet. Needs a Google Workspace test domain.", configFields: [], secretFields: [] },
  { type: "object_storage", name: "Amazon S3 / Azure Blob / Google Cloud Storage", category: "Documents & files", status: "planned", summary: "Scan cloud storage buckets for personal data.", reads: "Bucket listings and object contents (in memory).", keeps: META_ONLY, runsWhere: "Worker in the client's cloud account.", verification: "Not built yet. Needs read-only credentials to a test bucket.", configFields: [], secretFields: [] },
  { type: "mysql_database", name: "MySQL / MariaDB", category: "Databases & data stores", status: "planned", summary: "Same as the PostgreSQL scan, for MySQL-family databases.", reads: "Table and column structure; optional samples.", keeps: META_ONLY, runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "sqlserver_oracle", name: "SQL Server / Oracle", category: "Databases & data stores", status: "planned", summary: "Structure and personal-data scan for enterprise databases.", reads: "Table and column structure; optional samples.", keeps: META_ONLY, runsWhere: "Worker.", verification: "Not built yet. Needs licensed test instances.", configFields: [], secretFields: [] },
  { type: "mongodb", name: "MongoDB", category: "Databases & data stores", status: "planned", summary: "Collection and field scan for document databases.", reads: "Collection structure; optional samples.", keeps: META_ONLY, runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "warehouse", name: "Snowflake / BigQuery / Redshift", category: "Databases & data stores", status: "planned", summary: "Personal-data discovery across analytics warehouses.", reads: "Table and column structure; optional samples.", keeps: META_ONLY, runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "mobile_app_scanner", name: "Mobile app scanner", category: "Websites & apps", status: "planned", summary: "Permissions, SDKs and data flows declared by Android / iOS apps.", reads: "App package metadata.", keeps: "Permission and SDK lists.", runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "aws_posture", name: "AWS security posture", category: "Cloud & infrastructure", status: "planned", summary: "Encryption, access and logging settings relevant to personal data.", reads: "Configuration only (read-only role).", keeps: "Configuration findings.", runsWhere: "Worker in the client's AWS account.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "azure_posture", name: "Azure security posture", category: "Cloud & infrastructure", status: "planned", summary: "Same as above for Azure.", reads: "Configuration only.", keeps: "Configuration findings.", runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "gcp_posture", name: "Google Cloud security posture", category: "Cloud & infrastructure", status: "planned", summary: "Same as above for Google Cloud.", reads: "Configuration only.", keeps: "Configuration findings.", runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "entra_okta", name: "Microsoft Entra ID / Okta", category: "Identity & access", status: "planned", summary: "Who has access to what; joiner-mover-leaver and privileged-access evidence.", reads: "User, group and role lists.", keeps: "Counts and role summaries.", runsWhere: "Worker.", verification: "Not built yet. Needs a test tenant.", configFields: [], secretFields: [] },
  { type: "hrms", name: "HR systems (Keka, Darwinbox, Workday)", category: "Business applications", status: "planned", summary: "Employee data inventory and retention evidence.", reads: "Field definitions and counts.", keeps: META_ONLY, runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "crm", name: "CRM (Salesforce, Zoho, HubSpot)", category: "Business applications", status: "planned", summary: "Customer-data inventory and consent fields.", reads: "Field definitions and counts.", keeps: META_ONLY, runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "erp", name: "ERP (SAP, Oracle, Tally)", category: "Business applications", status: "planned", summary: "Vendor, employee and customer master-data inventory.", reads: "Field definitions and counts.", keeps: META_ONLY, runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "siem", name: "SIEM (Splunk, Microsoft Sentinel)", category: "Security monitoring", status: "planned", summary: "Incident and alert evidence for breach readiness.", reads: "Alert and incident summaries.", keeps: "Counts and timelines.", runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "vulnerability_scanner", name: "Vulnerability scanners (Nessus, Qualys)", category: "Security monitoring", status: "planned", summary: "Technical-safeguard evidence from existing scan reports.", reads: "Scan summaries.", keeps: "Counts by severity.", runsWhere: "Worker.", verification: "Not built yet.", configFields: [], secretFields: [] },
  { type: "ticketing", name: "Ticketing (Jira, ServiceNow, Freshdesk)", category: "Governance & tickets", status: "planned", summary: "Pull rights requests and incidents from the client's ticket system into the operations cases.", reads: "Ticket fields you choose.", keeps: "Case records you approve.", runsWhere: "Worker.", verification: "Not built yet. For now, create cases on the platform.", configFields: [], secretFields: [] },
  { type: "consent_manager", name: "Consent manager", category: "Governance & tickets", status: "planned", summary: "Consent records and withdrawals from a registered Consent Manager.", reads: "Consent artefact summaries.", keeps: "Counts.", runsWhere: "Worker.", verification: "Not built yet. Consent Manager conditions under the DPDP Rules take effect later; this will be built when providers publish interfaces.", configFields: [], secretFields: [] },
];

export const connectorByType = (t: string) => CONNECTORS.find((c) => c.type === t);
export const availableConnectors = () => CONNECTORS.filter((c) => c.status === "available" && !c.native);
export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  "Documents & files", "Databases & data stores", "Websites & apps", "Cloud & infrastructure",
  "Identity & access", "Business applications", "Security monitoring", "Governance & tickets",
];
