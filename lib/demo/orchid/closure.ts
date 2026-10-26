// Phase 7 demo data: which remediation actions Orchid Hill says are done, and the proof it uploads.
// The action titles are the ones the AI writes in phase 7 ("Fix: <finding title>"), so a row only
// matches if the AI really planned that action. Invented firm; nothing here is real.
import type { Filled } from "@/lib/templates/build";
import type { DocSpec, Line } from "./evidence";
import { FIRM } from "./content";

const fix = (finding: string) => `Fix: ${finding}`;

export const A = {
  access: fix("Access control and least privilege is not in place"),
  notice: fix("Notice available in required languages is not in place"),
  agents: fix("Authorised persons and referral partners: access to client data is not in place"),
  retention: fix("Retention schedule and erasure is only partly in place"),
  training: fix("Staff privacy awareness training is only partly in place"),
  breach: fix("Personal data breach notification is only partly in place"),
  xborder: fix("Cross-border transfer review is not in place"),
  children: fix("Children's data and verifiable parental consent is not in place"),
  cyber: fix("Cyber incident reporting to SEBI and the exchange within six hours is only partly in place"),
  consent: fix("Consent withdrawal is not in place"),
  vendors: fix("Data processor and vendor contracts is only partly in place"),
  apps: fix("Client data protection in trading apps and portals is only partly in place"),
} as const;

const ORG = FIRM.name;
const head = (title: string, owner: string, date: string): Line[] => [
  `# ${title}`,
  `${ORG}. Closure record dated ${date}. Control owner: ${owner}. Version 1.0. Approved by Rajiv Sinha, Chief Executive Officer, on ${date}. Effective from ${date}.`,
];

export const CLOSURES_FILLED: Filled = {
  tables: {
    Closures: [
      { action: A.access, done: "Quarterly access review done for all six systems; 11 leaver accounts removed; administrator rights cut from 19 to 6 people; review is now a standing quarterly task.", date: "2026-10-16", by: "Dev Malhotra, Chief Information Security Officer", proof: "Access_Review_Q2_FY27_Closure.pdf" },
      { action: A.notice, done: "Privacy notice published in English, Hindi, Marathi, Gujarati and Tamil on the website and in the app; app release 6.4 shows the notice language picker.", date: "2026-10-14", by: "Meera Kapoor, Chief Compliance Officer", proof: "Notice_Languages_Release_Note.docx" },
      { action: A.agents, done: "Data protection addendum signed by all 43 authorised persons; partner portal now shows only the partner's own clients.", date: "2026-10-12", by: "Meera Kapoor, Chief Compliance Officer", proof: "Authorised_Persons_DPA_Tracker.xlsx" },
      { action: A.retention, done: "Retention and erasure schedule approved by the board committee and loaded into the back office; first erasure run completed.", date: "2026-10-09", by: "Dev Malhotra, Chief Information Security Officer", proof: "Retention_Erasure_Schedule_v2.docx" },
      { action: A.training, done: "Training completion for the 642 staff brought to 100 percent; new joiner module added.", date: "2026-10-20", by: "Meera Kapoor, Chief Compliance Officer", proof: "Training_Completion_Oct.txt" },
      { action: A.consent, done: "Consent withdrawal option added to the app and the website, with a service level of seven days.", date: "2026-10-18", by: "Dev Malhotra, Chief Information Security Officer", proof: "Consent_Withdrawal_Procedure.docx" },
      { action: A.xborder, done: "Reviewed the transfer of data to our analytics vendor.", date: "2026-10-19", by: "Meera Kapoor, Chief Compliance Officer", proof: "Cross_Border_Note.txt" },
      { action: A.cyber, done: "Updated the incident reporting steps.", date: "2026-10-15", by: "Dev Malhotra, Chief Information Security Officer", proof: "Incident_Reporting_Update.txt" },
      { action: A.vendors, done: "Contracts with all 11 vendors now carry data protection terms.", date: "2026-10-17", by: "Meera Kapoor, Chief Compliance Officer", proof: "Office_Seating_Plan.txt" },
      { action: A.apps, done: "Security testing of the trading app completed and fixes released.", date: "2026-10-21", by: "Dev Malhotra, Chief Information Security Officer", proof: "Trading_App_Security_Test_Closure.pdf" },
    ],
  },
};

const rec = (file: string, format: DocSpec["format"], title: string, owner: string, date: string, lines: Line[], role: DocSpec["role"], description: string): DocSpec => ({
  file, format, controls: [], doctype: "Other", title, date, owner, description, lines: role === "weak" ? [`# ${title}`, ...lines] : [...head(title, owner, date), ...lines], role,
});

// Proofs. Good ones carry the action's own words, a date, an owner and an approval. The weak ones are
// the kind a client really sends: a short note that mentions the topic and proves nothing.
export const PROOFS: DocSpec[] = [
  rec("Access_Review_Q2_FY27_Closure.pdf", "pdf", "Access control and least privilege: implementation record", "Dev Malhotra, Chief Information Security Officer", "2026-10-16", [
    "Control: access control and least privilege. The control is implemented across OH Trade admin, ClientSphere Back Office, DP Core, OH Onboard, SupportDesk CRM and the Risk and Surveillance Engine. Owner: Chief Information Security Officer.",
    "# What was implemented",
    "- Every user account in the six systems was reviewed against the staff list. 11 accounts of people who had left the company were removed.",
    "- Administrator rights were reduced from 19 people to 6 named people, each with a written reason.",
    "- Access is now granted on a role basis only, with approval by the department head and the Chief Information Security Officer.",
    "- The access review is a standing quarterly task. The next review is due on 15 January 2027.",
    "# Evidence of operation",
    "- Evidence: the access review sheet with reviewer sign-off for each system, the leaver removal tickets and the administrator rights list are held in the compliance repository.",
    "- The control has been operating since 16 October 2026 and the first quarterly cycle is complete.",
  ], "good", "Access review closure record: leavers removed, admin rights cut, standing quarterly review."),
  rec("Notice_Languages_Release_Note.docx", "docx", "Notice available in required languages: release record", "Meera Kapoor, Chief Compliance Officer", "2026-10-14", [
    "The privacy notice is now available in English, Hindi, Marathi, Gujarati and Tamil on the website and in the mobile app (release 6.4). The notice language is chosen by the client at account opening and can be changed in settings.",
    "# Notice content",
    "- The notice states what personal data is collected, why, how to withdraw consent, how to complain to the Data Protection Board and how to reach the Privacy Officer.",
    "- Each language version was translated by a qualified translator and reviewed by the Chief Compliance Officer. The notice version is N-2026-04.",
    "# Evidence of operation",
    "- Evidence: screenshots of the language picker in the app and on the website, and the website publication record dated 14 October 2026, are attached to the compliance file.",
    "- The notice is shown to every new client before consent is taken. The required languages in the Eighth Schedule list were covered in this release.",
  ], "good", "Release record for the multilingual privacy notice."),
  {
    file: "Authorised_Persons_DPA_Tracker.xlsx", format: "xlsx", controls: [], doctype: "Log", title: "Authorised persons: data protection addendum tracker", date: "2026-10-12", owner: "Meera Kapoor, Chief Compliance Officer",
    description: "Tracker of 43 authorised persons and the signed data protection addendum.", role: "good",
    table: {
      sheet: "Authorised persons", intro: [
        `${ORG}. Authorised persons and referral partners: access to client data. Control owner: Chief Compliance Officer. Approved by Rajiv Sinha, Chief Executive Officer, on 2026-10-12. Version 1.0.`,
        "Each authorised person has signed the data protection addendum and now sees only the clients they serve through the partner portal. Evidence of operation: this tracker, the signed addenda and the partner portal access report dated 2026-10-12.",
      ],
      header: ["Authorised person code", "Registered city", "Addendum signed on", "Portal access limited to own clients", "Reviewed by"],
      rows: Array.from({ length: 43 }, (_, i) => [`AP-${String(1101 + i)}`, ["Mumbai", "Pune", "Ahmedabad", "Surat", "Chennai", "Nashik", "Indore"][i % 7]!, `2026-10-${String(1 + (i % 11)).padStart(2, "0")}`, "Yes", "Meera Kapoor"]),
    },
  },
  rec("Retention_Erasure_Schedule_v2.docx", "docx", "Retention schedule and erasure", "Dev Malhotra, Chief Information Security Officer", "2026-10-09", [
    "This schedule sets how long each kind of personal data is kept and how it is erased. It is approved by the Board Risk Committee and applied in ClientSphere Back Office.",
    "# Retention schedule",
    "- Client KYC records: 8 years after the account is closed, as the stock broker and depository rules require.",
    "- Contract notes and ledgers: 8 years. Call recordings: 5 years. Marketing consents: until withdrawn, then 1 year as proof.",
    "- Job applicant records: 1 year. Visitor and CCTV records: 90 days.",
    "# Erasure",
    "- When the retention period ends, an erasure run removes the record from the live system within 30 days and from backups on the next backup cycle. The first run was completed on 9 October 2026 and erased 1,284 expired records.",
    "- Evidence: the erasure run log, the approval minute and the back office configuration screenshot are held by the control owner. The schedule is reviewed every year.",
  ], "good", "Approved retention schedule with the first erasure run."),
  rec("Training_Completion_Oct.txt", "txt", "Staff privacy awareness training", "Meera Kapoor, Chief Compliance Officer", "2026-10-20", [
    "Staff privacy awareness training is now completed by all 642 staff, which is 100 percent. The training module covers personal data, consent, client rights, breach reporting and the safe use of client data.",
    "The training control is operating: new joiners are enrolled on the first day and complete the module within 15 days. Training completion is reported to the Privacy Officer every month.",
    "Evidence: the learning system completion report dated 20 October 2026 shows every employee with a completion date and a score of at least 70 percent. The report and the module content are held by the control owner, Chief Compliance Officer, and approved by the Chief Executive Officer.",
  ], "good", "Training completion record at 100 percent."),
  rec("Consent_Withdrawal_Procedure.docx", "docx", "Consent withdrawal procedure", "Dev Malhotra, Chief Information Security Officer", "2026-10-18", [
    "Clients can withdraw their consent as easily as they gave it. The option is in the app under Privacy and on the website under My Account. Consent withdrawal is acted on within seven days.",
    "# Procedure",
    "- The withdrawal request is logged in the consent register, and the marketing and group sharing permissions are switched off the same day.",
    "- Processing that the law or the stock broker rules require is not stopped, and the client is told which records must be kept and for how long.",
    "- The client receives a confirmation in the notice language they chose. The Privacy Officer reviews the withdrawal log every month.",
    "# Evidence of operation",
    "- Evidence: screenshots of the consent withdrawal screens, the consent register extract showing 37 withdrawals handled within seven days since 1 October 2026, and the approval minute.",
  ], "good", "Consent withdrawal procedure and first month of operation."),
  rec("Cross_Border_Note.txt", "txt", "Cross-border transfer note", "Meera Kapoor, Chief Compliance Officer", "2026-10-19", [
    "We looked at the analytics vendor that stores some client data outside India. The vendor has told us the servers are in Singapore. We will look at this again next quarter.",
    "No decision has been taken on whether the transfer should continue. A list of the countries is yet to be prepared.",
  ], "weak", "A short note: mentions the transfer but shows no review, no decision, no approval."),
  rec("Incident_Reporting_Update.txt", "txt", "Incident reporting steps", "Dev Malhotra, Chief Information Security Officer", "2026-10-15", [
    "The incident reporting steps have been updated. When an incident happens, the security team informs the compliance team. The compliance team will then decide whom to report to.",
    "The six hour reporting limit to SEBI and the exchange was discussed in the team meeting. A template for the report is being prepared.",
  ], "weak", "Mentions the topic only; no timed procedure, no template, no test."),
  {
    file: "Office_Seating_Plan.txt", format: "txt", controls: [], doctype: "Other", title: "Office seating plan", date: "2026-10-17", owner: "Facilities", role: "irrelevant",
    description: "Seating plan for the head office floors: not related to vendor contracts.",
    lines: [
      "# Head office seating plan, October 2026",
      `${ORG}, Mumbai head office. Floors 6, 7 and 8. Prepared by the facilities team on 17 October 2026.`,
      "Floor 6: Trading Operations, Depository Operations and Risk Management sit along the east wall. Meeting rooms 6A and 6B are bookable through the facilities desk.",
      "Floor 7: Technology, Customer Support and Human Resources. The server room is on this floor and is kept locked at all times. The pantry is next to the lift lobby.",
      "Floor 8: the Chief Executive Officer, the Chief Compliance Officer, Finance and the board room. Visitors are received on the ground floor and escorted up. Desks are moved every six months to balance the team sizes.",
      "Parking: 14 slots are reserved for senior staff. Cycle parking is in the basement. Fire exits and assembly points are shown on the floor maps near each lift.",
      "This plan is reviewed by facilities when teams move. It has no connection with any data processor agreement.",
    ],
  },
  // Trading_App_Security_Test_Closure.pdf is named in the closure log but deliberately never uploaded.
];

/** The proof file that the closure log names but the pack does not include (to show the "missing file" check). */
export const MISSING_PROOFS = ["Trading_App_Security_Test_Closure.pdf"];
/** Actions with no closure row at all (still open). */
export const STILL_OPEN = [A.children, A.breach];
