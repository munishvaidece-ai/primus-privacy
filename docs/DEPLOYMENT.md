# PRIMUS PRIVACY — Deployment guide (for the devops team)

This document is everything needed to stand the platform up and keep it running. It describes what has been **tested** and what has **not**, so you know where to look first.

## 1. What you are deploying

| Piece | What it is | Runs as |
|---|---|---|
| **Web app** | Next.js 14 application (the portal) | `npm start` on port 3000 |
| **AI worker** | A background Node process that does the AI's work: reads evidence, rates controls, drafts findings, triages cases, runs connector scans | `npm run ai:worker` |
| **Database + sign-in + file storage** | Supabase: Postgres (all data, row-level security), Auth (sign-in), Storage (evidence files) | Supabase cloud, or self-hosted |

The web app and the worker are the **same code and the same image**; they differ only in the start command. The worker has no inbound traffic (optional health port only). Both need `DATABASE_URL`.

There is **no email sending** in this release: invitations show a link, and rights-request replies / breach notices are *approved on the platform and then sent by your team through its normal channel*.

## 2. Decisions to make before go-live

1. **Where does the data live?** Supabase Cloud regions may not include India. If the client needs India-resident data, self-host Supabase (or use Postgres + Supabase Auth/Storage self-hosted) in an Indian region. This is open decision **D-03** in `DECISIONS.md`.
2. **Which AI engine?** Default is the built-in **offline rules engine**: nothing leaves your server. It is real and tested, but it is rules and text matching, not a language model, so it is more cautious (more items go to a person) than a language model would be. To use a language model set `AI_PROVIDER` + `AI_EXTERNAL_ENABLED=true` + key/model (and `AI_BASE_URL` for a model you host in India or inside the client's environment). Set `AI_DATA_REGION` truthfully — it is displayed to users as the headline guardrail. An outside model is only used for an engagement whose "allow outside model" switch is on.
3. **Where does the worker run?** For large clients, run the worker **inside the client's environment** (or a network that can reach their systems) so scans read data in place and the platform stores only metadata.

## 3. What you must provide

* PostgreSQL 15+ (Supabase), a Supabase project (Auth + Storage), and these values in the environment (see `.env.example`, which documents every setting):
  `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`.
* `DATABASE_URL` should be the role the app is meant to use (Supabase's `authenticator`/pooled connection); the app switches to the row-level-security role on every request. The setup commands in §4 need a role that may create tables and insert into `auth.users` (Supabase: `postgres`).
* `CONNECTOR_SECRET_KEY` (32 random bytes; `openssl rand -base64 32`). **Back it up** — without it saved connector credentials cannot be decrypted.
* The evidence storage bucket and its policies: apply `supabase/storage-policies.sql` as in earlier milestones.
* Optional: AI model settings, `CONNECTOR_FOLDER_ROOTS` for folder scans.

## 4. First-time setup (once per environment)

```bash
npm ci
npm run db:migrate:apply                # creates/updates the schema; records what has run
npm run bootstrap -- --tenant "Primus Partners" --admin-email you@primuspartners.in --starter-library
```

`bootstrap` is safe to repeat. It creates the practice, loads roles and permissions, creates the AI agent user (one per practice; it cannot sign in), creates a starter risk scoring model if none exists, loads the **DRAFT** starter control library (optional), and creates the first administrator. With Supabase configured it creates that administrator through Supabase Auth using `BOOTSTRAP_ADMIN_PASSWORD` (≥ 12 characters; change it after first sign-in; remove the variable afterwards).

> **Not tested against live Supabase:** the administrator-creation call and the worker's storage download use the documented Supabase APIs but were only exercised against a local Postgres. Do them in staging first (§7).

**Upgrading an older database** that was set up before migration tracking existed: run `npm run db:baseline` once (records the existing files as applied without running them) — only if you are certain the database matches the files — then `npm run db:migrate:apply` as normal on every deployment.

Every migration runs in a transaction; a failing file leaves the database untouched. Never edit a migration that has been applied (the runner refuses).

## 5. Running it

```bash
npm run build && npm start             # web  (port 3000)
npm run ai:worker                      # worker (set WORKER_HEALTH_PORT for GET /health)
```

* `GET /api/health` on the web app returns `{"ok":true}` when the database is reachable (503 otherwise); it reveals nothing else and needs no sign-in.
* The `Dockerfile` builds one image for both; `docker-compose.example.yml` shows web + worker + a one-shot migrate job. **The container files were written but could not be built or run where this was authored** (no container runtime). Build in CI and run the smoke check in §7.
* Run **one or more** workers; jobs are claimed with `FOR UPDATE SKIP LOCKED`, so extra workers just share the load. A job that dies mid-way is re-queued after 15 minutes.
* Logs go to stdout. The worker logs one line per job; nothing logs document text or connector credentials.

## 6. Security notes for reviewers

* **Two layers of access control**: application checks plus Postgres row-level security (forced) on every table. The AI is a *dedicated user* (`ai-agent@<tenant>.agent.primus.invalid`) holding an engagement role "AI Analyst"; everything it writes goes through the same domain functions and policies as a person and appears in the audit log under its own identity.
* **The AI cannot approve, override or reject its own work, cannot apply anything held at a sign-off gate, cannot change connector settings, and cannot read connector secrets except through one function that only an engagement's AI agent may call** — enforced by database triggers/policies, covered by tests.
* **Pause** removes the AI's engagement membership: it immediately loses all access, even mid-job.
* **Connector secrets** are AES-256-GCM encrypted by the app before storage; the table has no grants for any user role.
* **Website scanner** refuses private/internal addresses (SSRF guard) unless `CONNECTOR_ALLOW_PRIVATE_HOSTS=true`. **Folder scanner** only reads inside `CONNECTOR_FOLDER_ROOTS` and ignores links that leave them. **Database scanner** connects read-only and keeps only categories/counts.
* **Masking**: emails, Aadhaar, PAN, GSTIN, IFSC, card numbers, Indian phone numbers, passport numbers and IPv4 addresses are masked before any text reaches an outside model.
* **Known gaps** — please review: `npm audit` reports vulnerabilities in dependencies that pre-date this work (notably the pinned Next.js 14.2.35 line); upgrading Next.js was out of scope and should be scheduled. There is no malware scanning of uploaded files, no OCR (scanned PDFs/images are marked "unreadable" and go to a person), and no rate limiting on the web app.

## 7. Smoke check after deploying (about 15 minutes)

1. `GET /api/health` → 200.
2. Sign in as the administrator; open **Connectors** (the catalogue page).
3. Create an organisation and an engagement; add yourself as *Engagement Manager* (Members section); open **AI Operations Centre**.
4. Switch the AI on at *Assist*; upload a short text policy as evidence against a control; within a minute a suggestion should appear under **Needs your review** (worker is running and can read storage). If nothing appears, check the worker log.
5. Add a **Folder scan** connector on a mounted test folder (if enabled) and press *Test connection* then *Scan now*.
6. Press **Pause everything**: the status shows *AI is paused*; **Resume**.

## 6a. Local trial without Supabase (before staging)

`LOCAL_TESTING.md` describes trying the product on one computer with a one-click demo sign-in (`LOCAL_DEMO_AUTH=true`). It only works with `npm run dev`, a database on localhost and no Supabase configured; in any other case the app returns an error rather than enabling it. **Never set `LOCAL_DEMO_AUTH` in staging or production.** Real sign-in (Supabase) is what you configure per §3.

## 7a. Smoke check for the workspace and client portal (about 10 minutes)

1. Sign in as a Primus user: you land on **Dashboard**. Open Organisations, Engagements, Tasks, Notifications, Audit trail.
2. Create a task and a milestone on an engagement; mark the task done.
3. Open **Discovery** for an engagement whose client has started it; **Findings** shows draft findings (hidden from the client) with a Release button.
4. Sign in as a client user (invited from the organisation page): you land on **Overview**. Confirm the client cannot see draft findings, the Primus-only activity, or the Audit trail, and that the working report link on the engagement page gives "not found".
5. As the client: fill and submit the Discovery questionnaire; answer assessment questions and **Submit for review** (answers lock). As Primus: **Validate all answered** or **Return for changes**.
6. As Primus: **Release report to client** on the engagement page; as the client, download it from **Reports**.

The platform sends **no email**. Notifications are in the app only (bell and Notifications page). Client invitations still need your own delivery of the invitation link (see §3).

## 8. Tested / not tested

Workspace and client portal (migrations 0046–0048): `tests/workspace` (80 tests, 18 of which render every workspace and portal screen and submit their forms) covers released-only findings, assessment submit/lock/validate/return, read-only roles, discovery, tasks, clarifications, evidence requests, notifications, report release, data-principal request log, audit trail and portfolio figures against real PostgreSQL. The screens were type-checked and linted; they were rendered and driven form-by-form in tests, but not yet in a real browser session with Supabase sign-in.

Tested automatically (`TZ=UTC npm run test:db` plus `npx vitest run tests/ai tests/connectors`, against a real PostgreSQL): routing and the three autopilot levels; the four sign-off gates; pause/resume; the AI's inability to approve its own work; audit attribution; idempotency (no duplicate suggestions); offline engine rules; citation verification and masking; the Anthropic and OpenAI-compatible wire formats **against local mock servers only**; text extraction (text, HTML, Word, Excel, PDF); connectors against real folders, a real database and a local test website; encryption and secret isolation; the four operations flows and report issuance; the screens (rendered and driven through their forms); migrations from an empty database; the bootstrap script.

**Not tested:** any live language-model API; a live Supabase project (Auth admin API, Storage download, hosted Postgres roles); the Docker image build; a real browser session with sign-in (the screens were rendered and their forms exercised programmatically, and checked visually from screenshots); load at large data volumes; the SharePoint/Drive/cloud/identity/ticketing connectors (listed as *Planned*, not built).

## Front door: microsite first, then the platform

The Primus Privacy microsite (overview, platform, workflows, AI layer, configurator, demo portal, AI Operations Centre demo, obligations and readiness tools, sitemap) is static HTML in `public/site/` and ships inside the same image. No extra service is needed.

- A visitor who is not signed in and opens `/` is sent to `/site/index.html` (the microsite). `/site` also works.
- Every "Sign in" / "Login / Registration" button on the microsite goes to `/login`, the real sign-in of the platform. The old simulated login page was removed.
- Signed-in users who open `/` go to `/dashboard` (Primus team) or `/portal` (client users). Any protected page opened without a session goes to `/login`.
- The demo portal and AI Operations Centre pages on the microsite are demonstrations with fictional data held in the browser only; they are labelled as such and do not touch the platform database.
- To serve the microsite on a separate marketing domain, copy `public/site/` to that host and point its Sign in links at the platform's `/login` URL.
