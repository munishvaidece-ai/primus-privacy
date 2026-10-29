# Capability and gap matrix

Status as of 27 October 2026. "Built" means it works end to end in the demo. Nothing here is production-hardened yet: the one-click demo sign-in is local only, and real sign-in, hosting and a security review come before any client data.

| Capability | Status | What exists | What is missing |
|---|---|---|---|
| Privacy dashboard | Built | Portfolio view for Primus; programme view for each client | Trend history over time |
| Question sets and resources | Built | A bank of sector questions (a common set plus one set for each of the 19 sectors). A client answers the set for their own sector; the Primus team browses the whole bank and filters it by sector. A Resources page lets anyone pick a sector and read the DPDP Act, the Rules, the penalty ceilings and that sector's laws and guidelines | Questions feed the assessment only as read-only answers for the reviewer; they do not yet change which controls apply. New-sector instruments are marked "check before use" until confirmed against a source |
| DPDP and sector-law overlap flags | Built | A register of about 48 points where the DPDP Act and a sector's own rules cover the same ground, with which one governs (the Act is cumulative and prevails in a true conflict, s.38). Flagged on Resources, Regulations, the assessment control, the finding, the AI applicability reason and the question bank | Every entry is marked "Legal review pending". No "satisfied by sector law" switch: assessment records are locked, so the assessor writes the law and section in the decision reason |
| Client follow-up (DPO Mate) | Built | A short preliminary report (PDF) once the final report is released, and a "Connect with us" form to book a 30 minute consultation, with a notice, a recorded consent, and the contact person's mobile number. Requests are saved, shown to the Primus team in a Consultation requests page, and emailed to a Primus inbox when email is set up | Calendar booking, reminders and an acknowledgement email to the contact person |
| Compliance audit and controls | Built | 139 controls (DPDP and sector), applicability engine for the Act, Rules and 19 sector regimes, tests, evidence, findings, remediation, final report | Control owners and periodic re-review |
| Data inventory and discovery | Built | Data map, record of processing, read-only database scan that stores no values, comparison with the client's inventory | More connector types |
| Breach management | Partly built | Breach case, AI assessment, drafted notices with a person's sign-off, affected systems and vendors, who else must be told by sector, raise a finding and action | Incident timeline and evidence preservation, post-incident review form |
| Data principal rights | Partly built | Request log with due dates (client portal); AI-assisted rights case with a drafted reply | Identity verification, routing tasks to system owners, fulfilment evidence |
| Consent and notice | Partly built | AI consent review of a consent wording | Notice versions, consent records, withdrawal, cookie scan and banner management |
| Vendor / third-party | Partly built | Vendors on the data map; AI vendor review scoring | Due-diligence workflow, risk rating register, reassessment calendar |
| Privacy impact assessment (PIA/DPIA) | Missing | The assessment engine could host it | Scoping, risk and mitigation workflow, report |
| Privacy programme operations | Partly built | Tasks, milestones, notifications, clarifications, stakeholders, audit trail | Policy register, retention schedules, training records |
| Redaction and masking | Missing | | Everything; defer |
| Cookie and banner management | Missing | | Site scan (quick win inside Assess), then banner and consent log |

Offerings: Assess (live today), Manage (add vendors, PIA, programme operations, a full rights workflow), Discover (the data scan, already inside Assess).
