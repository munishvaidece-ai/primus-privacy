# PRIMUS PRIVACY — User guide for the practice team

Plain language, no technical knowledge needed.

## The idea in one paragraph

The AI does the routine work; your people supervise and sign off. For every engagement you choose **how much the AI may do alone**. It reads evidence, decides which controls apply, rates them, drafts findings and the report summary, and handles day-to-day cases (rights requests, breaches, consent and vendor reviews). Anything it is unsure about, or that you have told it must be signed off by a person, waits in your **Needs your review** list. Everything — what it did, what you decided — is recorded and cannot be edited.

## Starting an engagement (your first one)

1. **Create the client organisation and engagement** as you always have. Add yourself as **Engagement Manager** (engagement page → Members).
2. Make sure the engagement's **controls are chosen** (a published control library pinned to the engagement) and an **assessment** exists.
3. Open **AI Operations Centre** (engagement page). Tick **Switch the AI on**, choose a level, check the four sign-off gates, **Save**.
   *Tip for a first engagement:* start at **Assist** for a day so you can see everything the AI proposes, then move to **Supervised**.
4. **Give it material.** Upload evidence against controls as normal — no change to how you upload. Optionally add **Connectors** (below) so the AI can look at systems directly.
5. Work through **Needs your review** each day. Use **Run now** (Overview) to make the AI look for work immediately; otherwise it checks every 15 minutes.

## The three levels

| Level | What the AI does alone | You |
|---|---|---|
| **Assist** | Nothing is applied. It prepares and explains. | Approve everything. |
| **Supervised** | Applies routine, low/medium-stakes work when it is at least 90% sure. | Review the rest. |
| **Full autopilot** | Applies work when it is at least 75% sure (critical controls: at least 90%). | Review the exceptions and the sign-off gates. |

The percentages can be changed in Settings. "Sure" is the AI's own confidence, adjusted down when it cannot find supporting text in a document.

## The four sign-off gates

Always on unless you switch them off for a client who has agreed otherwise. Only an **Engagement Manager** can decide a gated item:
1. **Reject evidence on a critical control**
2. **Release critical findings**
3. **Issue the final report** (the report summary is saved as a numbered version)
4. **Send breach notices** (the notice is approved on the platform; your team then sends it)

## Deciding on a suggestion

Each card shows what the AI proposes, its **reasoning**, and — for documents — the **exact sentence it relied on** (✓ found in the document, ⚠ could not be found: check it). You can **Approve**, **Change it** (edit the answer and say why), or **Reject** (say why). You can tick several routine items and approve them together. Your decision is applied *as you*: it appears in the main audit log under your name.

## Seeing exactly what the AI read

Two screens answer "what did the AI look at, and who gave it?":

* **What the AI did** lists every piece of AI work, including work applied automatically. Each row has an **Evidence trail** showing: the documents and data it used; who supplied each (the Primus team or the client organisation, by name); the screen it came through (for example Client portal, Evidence centre, or Primus workspace, evidence upload); when; why it was chosen; the sentences it relied on; its reasoning; the engine used; its confidence; the autopilot level and the rule that allowed it to proceed; and a link to the record it changed.
* **Data it reads** is the complete inventory: documents and evidence, assessment answers, the data landscape, control tests, cases and connector scans, each with who supplied it and how many AI outputs used it. It also lists what the AI does **not** read (the discovery questionnaire, clarification messages, other clients' data).

The trail is written when the AI produces its output and cannot be changed later. With the built-in engine nothing is sent outside the platform; with an optional outside AI service, personal identifiers are masked first and the trail says so.

## Pause

**Pause everything** (Overview) takes the AI's access away immediately. Nothing it was doing can continue. **Resume** brings it back.

## Connectors — letting the AI look at systems

Start with uploads; add connectors as the client approves each. The portal's **Connectors** page lists all of them. **Available now:** document upload (built in), **folder / file share scan**, **PostgreSQL database scan**, **website privacy & consent scan**. Everything else on that page is **Planned** and cannot be set up yet.

A scan keeps only **names, locations and the kinds of personal data found** (e.g. "table `customers` has email, phone, Aadhaar") — never the data. Database scans use a **read-only** account you ask the client for. Credentials are stored encrypted and nobody can read them back.
*Large clients:* ask your devops team to run the worker inside the client's environment so the data never leaves it.

## Operations — rights requests, breaches, consent, vendors

**Operations** tab → open a case and fill in the short form. The AI works out the deadline, assesses the case and drafts the reply or notice.
* **Rights request** — 90 days to respond (DPDP Rules 2025).
* **Breach** — detailed report to the Data Protection Board within 72 hours; affected people informed without delay. The notice is held for an Engagement Manager.
* **Consent review** — checks a consent text for the things the Act requires.
* **Vendor review** — scores a processor's answers (contract, breach notice time, encryption, deletion, audit rights…).
Open the case to read the assessment, edit the draft, **approve for sending**, and close it. *The platform records the approval but does not send emails.* Please have your practice confirm the deadlines against the latest official text; they are held in one place in the code.

## What the AI cannot do (by design)

Approve, change or reject its own work · apply anything held at a gate · change settings or connectors · finalise an assessment or lock scope · see anything while paused · see anything on an engagement where it has not been switched on.

## The workspace — your day-to-day

After signing in you land on **Dashboard**: clients, engagements and where each one is (Draft, Discovery, Assessment, Validation, Reporting, Remediation, Closed), what is overdue, and what is waiting for you. The left menu is grouped by portfolio and by delivery stage; every list can be filtered.

* **Tasks** — tasks and milestones for you or for the client. Milestones are shown to the client.
* **Discovery** — read the client's questionnaire answers and the obligations they point to; **Approve scope** or **Return for changes**.
* **Assessments** — open an assessment; **Validate all answered** once you have checked the answers, or **Return for changes**. After the client submits, their answers are locked.
* **Evidence review** — accept or reject what clients upload; ask a client for evidence from here or from the engagement page.
* **Findings** — new findings are **draft** and invisible to the client. Tick the ones to share and **Release**. A release cannot be undone.
* **Clarifications** — short two-way threads with the client.
* **Engagement page → Reports** — **Release report to client** creates a client copy (draft findings left out), kept as a numbered version.
* **Audit trail** — who did what and when, for an engagement.

The platform does not send email. People see alerts under **Notifications** when they sign in.

## For your client (what they see)

Clients sign in to a **portal** built around one engagement: an Overview with "what to do next", the Discovery questionnaire (13 short steps, saved as they type), the Assessment, evidence requests and uploads, clarifications, released findings, remediation, risks, released reports and a log of Data Principal requests. People with read-only roles (for example CXO / Executive Viewer) can look but not change anything.

## Honest limits

* The built-in engine is rules and text matching, not a language model: it is careful, so expect more items in your review list than with a language model. If your devops team connects a model (hosted where the client requires), the same screens and controls apply.
* **Scanned documents and images are not read** (no OCR): they are marked unreadable and come to you.
* It rates **controls from the evidence it is given**. A thin evidence set gives thin, low-confidence output.
* How careful it is about a control depends on the control's wording (e.g. "breach", "consent", "children" make a control *critical*). Review how your control titles read.
* The starter control library is a **draft**: review and edit it before publishing.
