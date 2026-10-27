# Live demo script: Orchid Hill Securities (all seven phases)

About 25 minutes. Everything is fictional. Orchid Hill is a mid-sized stock broking firm: 9 business units, 12 processing activities and 11 vendors.

## Before you start

1. `npm run local:db`, `npm run local:setup` (once), `npm run dev`. The AI worker starts with the site.
2. Open http://localhost:3000, sign in on the **Primus door** as **Demo Administrator**, open **Orchid Hill Securities**, then **Live Run**.
3. Optional: in `.env` set `AI_DEMO_PACE_MS=800` so each item shows up in the live log one at a time (restart `npm run dev`).
4. Download the demo pack from the top of the Live Run screen. Files are in one folder per phase, split into "From the client" and "From Primus", which is where they would come from in real life.

**Two ways to demo.** (a) From the Demo Administrator alone: the Live Run does every step. (b) With both logins: the Demo Administrator runs the AI, approvals and release, and the Orchid Hill login (for example Meera Kapoor, in a second browser) uploads its own files from **Live journey** and sees each phase turn to Done. Both show the same flow.

**To run it again for someone else:** Demo Administrator, **Demo environment**, **Clear the demo data**. Orchid Hill goes back to empty; the other fictional clients stay.

**Phase 5 note:** when the client uploads the Evidence Index and the files, the platform links them to controls by itself, so the "Link the files to controls" button will report that there is nothing new to link. That is expected.

**After phase 3** open **Regulations** to show which DPDP Rules and sector rules bind Orchid Hill, with the reason for each. The client sees the same under **What applies to you**.

Sign in as the right person for the hand-off. The screen tells you when you are not: client uploads (phases 1, 2, 5 and the phase 7 Closure Log) as **Client door, Orchid Hill**; the Control Test Log (phase 4), the AI buttons, approvals and release as the Primus side.

## Phase by phase

| Phase | Who uploads | What goes in | What the AI does | What to point at |
|---|---|---|---|---|
| 1 Engagement set up | Client | Scope Intake Form + 4 supporting documents | Reads registrations and activities, proposes **Stock broking** as the sector (and leaves banking for a person), creates 9 business units | Try the three bad files first: wrong template, renamed headings, empty required cells. Each is refused with sheet, row, column |
| 2 Discovery | Client (or a connector) | Data Inventory + vendor list; or **Scan the database now** first | Loads systems, stores, vendors, purposes, data elements and activities; drafts 48 questionnaire answers, each citing its cell; flags gaps | Scan first, then read the inventory. Live log shows "Point to raise" lines for the copy in `archive.legacy_kyc_2019`, `marketing_tmp.leads_export`, `reception.visitor_register`, personal data in `crm.support_tickets.message_text`, and Aadhaar "masked" vs full numbers |
| 3 Applicability | Nobody (uses 1 and 2) | none | Decides 91 controls: 40 apply, 51 do not, each with a reason | Create the scope, run, approve, lock |
| 4 Assessment | Primus consultant | Control Test Log (24 tests) | Records the tests, rates each control from them | 6 failed tests lead to weak ratings |
| 5 Evidence validation | Client | Evidence Index + 34 files | Links files to controls, reads each, accepts or queries, re-rates | Anything not in the index, or listed but missing, is reported instead of guessed |
| 6 Findings released | Nobody (uses 4 and 5) | none | Drafts findings for weak controls; a critical one waits for a person | Release is a person's action |
| 7 Remediation and final report | Client, then Primus | Closure Log + proof files | Plans actions from findings; checks each proof; drafts the final report for a person to issue | Weak proofs are sent back, the irrelevant one is rejected |

## At the end of phase 7: the final report (2 minutes)

After the assessment is finalised and the AI has drafted the final report, approve it (Primus side). Then press **Release the report to the client** in phase 7 and use **Download PDF**. The PDF opens with the AI's headline and summary, and has a **Remediation Roadmap** in 30, 60 and 90 day steps. Sign in as the client and open **Live journey**: phase 7 shows **Download the report (PDF)**.

## After phase 7: a breach (3 minutes)

1. On the Live Run, press **After the assessment: incidents and cases**. In demo mode, press **Open a sample incident** (a client list emailed to the wrong address).
2. Open **Needs your review**. Approve the breach assessment and the notices (only an Engagement Manager, such as the Demo Administrator, can approve the notices).
3. Open the case. Point at: the affected system and vendor taken from the data map; **Who may have to be told** (the DPDP Board plus the sector regulator and CERT-In for this organisation); the draft notices with placeholders for unknown facts; and **Raise a finding and remediation action**, which feeds the normal findings and remediation flow.
4. Say: the DPDP breach duties are enforceable from 13 May 2027; the platform helps a person decide and records the decision. It does not decide whether an incident is reportable, and it sends nothing.

## Things to say

* The AI reads only the template and the files above. Nothing is guessed, and each answer shows its cell or file.
* Where the AI is unsure or the consequence is high, it stops: look at **Waiting for a person**.
* **How much the AI does alone** (right-hand panel): switch between Assist, Supervised and Full autopilot and rerun a phase.
* The database scan keeps names and categories only, never values.
* No external AI service is called. Legal mapping is indicative, not legal advice.

## If something looks stuck

The live log (right) shows the queue. If a job fails, its reason shows under the log. `npm run local:setup` again is safe. To start Orchid Hill from empty, stop the app, run `docker compose -f docker-compose.local.yml down -v`, then `npm run local:db`, `npm run local:setup`, `npm run dev`.
