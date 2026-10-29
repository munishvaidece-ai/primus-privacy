// The notice and consent for the "Connect with us" form, and the checks on what
// the person types. Pure, so the form, the server and the tests share one copy.
//
// The notice is written in plain language and says what is collected, why, who
// sees it, how long it is kept, what the person can do, and how to complain.
// The consent text is stored with every request, together with the version, so
// Primus can show later exactly what the person was told and agreed to.

import { SELECTABLE_SECTORS } from "@/lib/regulation";

export const NOTICE_VERSION = "2026-10-29.1";

export const CONSULTATION_PURPOSE = "to contact the contact person named in the form, by phone, email or message, and arrange a 30 minute consultation with our experts about your DPDP alignment";

/** Retention is a product default; Primus should confirm it with its own counsel before launch. */
export const RETENTION = "until the consultation is held or closed, and then for up to 12 months, after which the request is deleted";

export interface NoticeContent {
  heading: string;
  collected: string[];
  purpose: string;
  sharing: string;
  retention: string;
  rights: string;
  withdraw: string;
  complaint: string;
}

/** `contact` is the address people write to to use their rights; it comes from settings, so it is passed in. */
export function noticeFor(contact: string | null): NoticeContent {
  const where = contact ? `write to ${contact}` : "tell your Primus contact";
  return {
    heading: "What we collect, why, and what you agree to",
    collected: [
      "About your organisation: its name, sector, size band and website (the size band and website are optional).",
      "About the contact person: name, designation, work email and mobile number.",
      "About the consultation: the topics you want to discuss, a preferred time of day, and any note you choose to write.",
    ],
    purpose: `We use this only ${CONSULTATION_PURPOSE}. We do not use it for any other purpose, and we do not add anyone to a marketing list.`,
    sharing: "The Primus Partners team working on your engagement can see it, and it is sent to a Primus inbox so someone can get back to you. We do not sell it or share it with anyone outside Primus Partners, other than the service providers who host our systems and email, under contract.",
    retention: `We keep it ${RETENTION}.`,
    rights: `You can ask to see what we hold about you, to correct it, or to have it erased. To do any of these, ${where}.`,
    withdraw: `You can take back your agreement at any time, as easily as you gave it: ${where}, and we will stop contacting the contact person and delete the request.`,
    complaint: "If you are not happy with how we handle your data, tell us first. You can also complain to the Data Protection Board of India under the Digital Personal Data Protection Act, 2023.",
  };
}

/** The exact words the person agrees to. Stored with the request. */
export const CONSENT_TEXT =
  "I have read the notice above. I agree that Primus Partners may use the details I have entered in this form to contact the contact person named here, by phone, email or message, to arrange and hold a 30 minute consultation about our DPDP alignment. I understand that I can take back this agreement at any time. If the contact person is someone other than me, I confirm that they know I am sharing their details and have agreed to be contacted.";

export const TOPICS = [
  { value: "report_insights", label: "Deeper insights on my report" },
  { value: "dpdp_alignment", label: "DPDP alignment review" },
  { value: "sector_rules", label: "Rules for my sector" },
  { value: "vendors", label: "Vendors and cross-border transfers" },
  { value: "rights_breach", label: "Rights requests and breach readiness" },
  { value: "other", label: "Something else" },
] as const;

export const TIMES = [
  { value: "morning", label: "Morning (9 am to 12 pm)" },
  { value: "afternoon", label: "Afternoon (12 pm to 4 pm)" },
  { value: "evening", label: "Late afternoon (4 pm to 6 pm)" },
  { value: "any", label: "Any time works" },
] as const;

export const BANDS = [
  { value: "lt_50", label: "Under 50" },
  { value: "50_250", label: "50 to 250" },
  { value: "250_1000", label: "250 to 1,000" },
  { value: "1000_5000", label: "1,000 to 5,000" },
  { value: "gt_5000", label: "More than 5,000" },
] as const;

export interface ConsultationInput {
  organisationName: string;
  sectorKey: string | null;
  employeeBand: string | null;
  website: string | null;
  contactName: string;
  contactDesignation: string;
  contactEmail: string;
  contactMobile: string;
  topics: string[];
  preferredTime: string | null;
  note: string | null;
  submitterIsContact: boolean;
  consent: boolean;
}

export interface ConsultationChecked extends Omit<ConsultationInput, "consent"> {
  noticeVersion: string;
  consentText: string;
}

/** Turns a typed mobile number into digits with an optional leading +, or null if it is not a plausible number. */
export function normaliseMobile(raw: string): string | null {
  const s = raw.trim().replace(/[\s().-]/g, "");
  if (!/^\+?[0-9]{8,15}$/.test(s)) return null;
  // A plain 10-digit Indian mobile starting 6 to 9 gets the +91 prefix so it reads the same everywhere.
  if (/^[6-9][0-9]{9}$/.test(s)) return `+91${s}`;
  if (/^0[6-9][0-9]{9}$/.test(s)) return `+91${s.slice(1)}`;
  return s;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Checks the form. Returns the clean values, or the first problem in words the person can act on. */
export function checkConsultation(input: Partial<Record<keyof ConsultationInput, unknown>>): { ok: true; value: ConsultationChecked } | { ok: false; error: string } {
  const str = (v: unknown) => String(v ?? "").trim();
  const organisationName = str(input.organisationName);
  const contactName = str(input.contactName);
  const contactDesignation = str(input.contactDesignation);
  const contactEmail = str(input.contactEmail).toLowerCase();
  const mobile = normaliseMobile(str(input.contactMobile));
  if (!organisationName) return { ok: false, error: "Please enter your organisation's name." };
  if (organisationName.length > 200) return { ok: false, error: "The organisation name is too long." };
  if (!contactName) return { ok: false, error: "Please enter the contact person's name." };
  if (contactName.length > 120) return { ok: false, error: "The contact person's name is too long." };
  if (!contactDesignation) return { ok: false, error: "Please enter the contact person's designation." };
  if (contactDesignation.length > 120) return { ok: false, error: "The designation is too long." };
  if (!EMAIL.test(contactEmail) || contactEmail.length > 254) return { ok: false, error: "Please enter a work email address that looks right." };
  if (!mobile) return { ok: false, error: "Please enter the contact person's mobile number with the country code or as a 10-digit number." };
  if (input.submitterIsContact !== true && input.submitterIsContact !== false) return { ok: false, error: "Please tell us whether you are the contact person or are filling this in for a colleague." };
  if (input.consent !== true) return { ok: false, error: "Please read the notice and tick the box to agree. We cannot take your request without it." };
  const note = str(input.note);
  if (note.length > 600) return { ok: false, error: "Please keep the note under 600 characters." };
  const validSectors = new Set<string>(SELECTABLE_SECTORS.map((s) => s.key));
  const sector = str(input.sectorKey);
  const topicSet = new Set<string>(TOPICS.map((t) => t.value));
  const topics = Array.from(new Set((Array.isArray(input.topics) ? input.topics : [input.topics]).map(str).filter((t) => topicSet.has(t))));
  const band = str(input.employeeBand);
  const time = str(input.preferredTime);
  let website = str(input.website);
  if (website) {
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
    if (website.length > 200 || !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(website)) return { ok: false, error: "That website address does not look right." };
  }
  return {
    ok: true,
    value: {
      organisationName,
      sectorKey: validSectors.has(sector) ? sector : null,
      employeeBand: BANDS.some((b) => b.value === band) ? band : null,
      website: website || null,
      contactName,
      contactDesignation,
      contactEmail,
      contactMobile: mobile,
      topics,
      preferredTime: TIMES.some((t) => t.value === time) ? time : null,
      note: note || null,
      submitterIsContact: input.submitterIsContact === true,
      noticeVersion: NOTICE_VERSION,
      consentText: CONSENT_TEXT,
    },
  };
}
