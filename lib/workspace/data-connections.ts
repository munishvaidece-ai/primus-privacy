// What a client needs to know to hand over documents and, if they choose, let
// Primus look at a system. Plain data and text builders (no database), shared
// by the client page, the Primus page and the tests.
//
// A connection is always the client's decision. The client asks for one here
// (this sends a message to Primus); Primus sets it up in the engagement's AI
// Operations Centre with a read-only account the client provides; the platform
// keeps only metadata, never copies of the data. Nothing here pretends a
// connector exists that the catalogue lists as "planned".

import { CONNECTORS, connectorByType, type ConnectorDef } from "@/lib/connectors/catalog";
import { PHASES } from "@/lib/live/config";

/** Connectors a client can ask for today: built and tested, and not the built-in upload. */
export const REQUESTABLE: ConnectorDef[] = CONNECTORS.filter((c) => c.status === "available" && !c.native);

/** What the client prepares for each connector, in plain words. */
export const WHAT_WE_NEED: Record<string, string[]> = {
  postgres_database: [
    "A read-only database account, created just for this review. It should see table structure and be allowed to read, never write.",
    "The server address, port and database name, and the schemas to look at (or all of them).",
    "Network access: your IT team allows the address Primus gives you to reach the database, or the scan runs inside your network.",
    "Your approval, in writing, from the person who owns the data.",
  ],
  document_folder: [
    "The folder or file share, shared read-only with the worker that runs the scan (inside your environment if you prefer).",
    "A list of the folders to include and any to leave out, such as HR or legal.",
    "Your approval from the owner of each folder.",
  ],
  website_scanner: [
    "The public address of the website or app page to check. No password is needed; the scan sees only what any visitor sees.",
    "Any other sites or sub-domains that collect personal data, such as a careers or investor page.",
  ],
};

/** Other systems we can look at once they are built, so the client sees what is coming and what is not available today. */
export const PLANNED_NAMES: string[] = CONNECTORS.filter((c) => c.status === "planned").map((c) => c.name);

export interface DocumentStep {
  phase: number;
  name: string;
  /** What to send, in a sentence. */
  send: string;
  /** Template to download, when there is one. */
  hasTemplate: boolean;
  /** Files that go with it, when there are any. */
  extra: string | null;
}

/** The steps where the client sends something: from the journey's own definition, so this page and the journey never disagree. */
export const DOCUMENT_STEPS: DocumentStep[] = PHASES.filter((p) => p.from.side === "client").map((p) => ({
  phase: p.n,
  name: p.name,
  send: p.from.how,
  hasTemplate: Boolean(p.template),
  extra: p.support ? `${p.support.label}. ${p.support.hint}` : null,
}));

export const OTHER_SYSTEM = "other";

export interface ConnectionRequestInput {
  type: string;
  systemName: string;
  hostedWhere: string;
  contactName: string;
  notes: string;
}

export interface ConnectionRequestText { subject: string; question: string }

/** Turns the form into the message Primus receives. Throws a message safe to show. */
export function connectionRequestText(raw: Partial<Record<keyof ConnectionRequestInput, unknown>>): ConnectionRequestText {
  const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const type = clean(raw.type, 60);
  const def = type === OTHER_SYSTEM ? null : connectorByType(type);
  if (type !== OTHER_SYSTEM && (!def || def.status !== "available" || def.native)) throw new Error("Choose one of the listed systems, or Other.");
  const systemName = clean(raw.systemName, 120);
  if (systemName.length < 2) throw new Error("Tell us the name of the system, for example “Customer CRM database”.");
  const hostedWhere = clean(raw.hostedWhere, 160);
  const contactName = clean(raw.contactName, 120);
  if (contactName.length < 2) throw new Error("Tell us who looks after this system, so Primus knows whom to ask.");
  const notes = clean(raw.notes, 1500);
  const kind = def ? def.name : "Another system (not in the list yet)";
  return {
    subject: `Connection request: ${kind}, ${systemName}`.slice(0, 300),
    question: [
      `We would like Primus to look at a system we run.`,
      `Kind of system: ${kind}${def ? "" : ". This one is not built yet, so please tell us what you can do instead."}`,
      `System name: ${systemName}`,
      `Where it runs: ${hostedWhere || "not said"}`,
      `Person who looks after it: ${contactName}`,
      notes ? `Notes: ${notes}` : "",
      `We have not shared any password or connection details in this message. Please tell us how you would like us to send them.`,
    ].filter(Boolean).join("\n"),
  };
}
