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

## Honest limits

* The built-in engine is rules and text matching, not a language model: it is careful, so expect more items in your review list than with a language model. If your devops team connects a model (hosted where the client requires), the same screens and controls apply.
* **Scanned documents and images are not read** (no OCR): they are marked unreadable and come to you.
* It rates **controls from the evidence it is given**. A thin evidence set gives thin, low-confidence output.
* How careful it is about a control depends on the control's wording (e.g. "breach", "consent", "children" make a control *critical*). Review how your control titles read.
* The starter control library is a **draft**: review and edit it before publishing.
