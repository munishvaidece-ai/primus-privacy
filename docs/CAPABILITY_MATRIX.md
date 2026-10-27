# Capability and gap matrix

Status as of 27 October 2026. "Built" means it works end to end in the demo. Nothing here is production-hardened yet: the one-click demo sign-in is local only, and real sign-in, hosting and a security review come before any client data.

| Capability | Status | What exists | What is missing |
|---|---|---|---|
| Privacy dashboard | Built | Portfolio view for Primus; programme view for each client | Trend history over time |
| Compliance audit and controls | Built | 91 controls (DPDP and sector), applicability engine for the Act, Rules and 12 sector regimes, tests, evidence, findings, remediation, final report | Control owners and periodic re-review |
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
