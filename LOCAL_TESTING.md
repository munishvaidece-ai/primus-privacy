# Trying PRIMUS PRIVACY on your own computer

This guide is for testing everything yourself **before** it goes to your devops team. Sign-in is a one-click demo sign-in here: you pick a person and you are in. No password, no Supabase, no internet service needed. It uses only fictional demo data.

It works **only on your computer**. The app refuses to start the demo sign-in in a production build, against a database that is not on your computer, or when Supabase is configured (see "Handing over to devops").

## What you need (one time)

1. **Node.js 20 (LTS)**: nodejs.org, default options.
2. **Docker Desktop**: docker.com, default options. Start it and wait until it says it is running. (It only provides the database. If you cannot install Docker, install PostgreSQL 15 or newer instead and put its connection string in `.env` as `DATABASE_URL`; it must be on `localhost`.)
3. The unpacked project folder. Open a terminal (Windows: PowerShell; Mac: Terminal) **inside that folder**.

## Start it (about 5 minutes the first time)

```
npm ci
npm run local:db
npm run local:setup
npm run dev
```

Then open **http://localhost:3000**.

* `npm run local:db` starts the database in Docker.
* `npm run local:setup` prepares everything: it creates your `.env` settings file, builds the tables, creates "Primus Partners" with its roles, and adds three fictional client organisations with a team and sample data. You can run it again safely; it will not duplicate anything.
* `npm run dev` starts the app. Leave that window open while you test; press Ctrl+C to stop.

The next day, you only need `npm run local:db` (if Docker was restarted) and `npm run dev`.

## Signing in: two doors

Open http://localhost:3000 and click **Sign in**. You choose a door:

* **Primus team workspace**: what the consulting team sees. One big button signs you in as the **Demo Administrator**, who can do everything. Or pick another team member to see what their role can and cannot do.
* **Client organisation portal**: what a client sees. Pick one of three organisations, then a person in it.

To switch, press **Log out** (top right) and choose again. No password is asked anywhere.

**Primus team**

| Person | Role | Use them to check |
|---|---|---|
| Demo Administrator | Platform Administrator, Engagement Manager on every engagement | the whole Primus side |
| Priya Nair | Practice Partner, Engagement Manager (Meridian, Vitalis) | partner view of the portfolio |
| Arjun Mehta | Consultant (all engagements) | what a consultant cannot do (release) |
| Meera Iyer | Auditor (Meridian) | read-only view and the audit trail |

**Three fictional client organisations, each at a different stage**

| Organisation | Stage | People |
|---|---|---|
| Meridian Finserve Ltd (NBFC, Mumbai) | Results delivered: assessment validated, 4 findings released, report v1 released, remediation in progress | Asha Verma (Client Administrator), Rohan Gupta (Privacy Officer), Kabir Shah (CXO, read-only), Neha Joshi (Business Owner) |
| Vitalis Care Network Pvt Ltd (hospital group, Bengaluru) | Client is mid-assessment (14 of 25 answered), 3 evidence requests open, 2 draft findings not yet released | Dr Ananya Rao (Client Administrator), Vikram Sethi (Privacy Officer), Pooja Menon (CXO, read-only) |
| Bazaarly Commerce Pvt Ltd (e-commerce, Gurugram) | Just started: discovery in progress, tasks assigned | Sameer Khanna (Client Administrator), Ishita Bose (Privacy Officer) |

Everything is invented for demonstration: names, numbers, findings, risks and requests.

## A suggested leadership demo (about 10 minutes)

1. **Primus door**, Demo Administrator: show the *Dashboard* (three clients at three phases), open *Organisations*, then Meridian's engagement (delivery status, release findings, release report).
2. **Client door**, Meridian, Asha Verma: *Overview*, *Findings* (only released ones), *Risks* heat map, *Remediation*, *Reports* (download the PDF), *Rights requests*.
3. **Client door**, Vitalis, Vikram Sethi: open *Assessment*, answer a question, see the progress move. Open *Evidence centre*.
4. Back on the **Primus door**, open Vitalis: the 2 draft findings exist but the client cannot see them until released. Release one, then sign in as Dr Ananya Rao to show it has appeared.
5. **Client door**, Bazaarly, Sameer Khanna: the guided *Discovery* questionnaire, which saves as you type.
6. Sign in as **Kabir Shah** (CXO): everything is read-only.

## A good test to run first

1. As **Sameer Khanna** (Bazaarly) or **Vikram Sethi** (Vitalis): finish the discovery steps or the assessment questions (they save by themselves). **Submit for review** is enabled only when all questions are answered. Submit; the answers lock.
2. As the **Demo Administrator**: open that engagement's assessment, press **Validate all answered**. Open *Findings*: the draft findings (for example at Vitalis) are invisible to the client; **Release** one. On the engagement page press **Release report to client**.
3. As that client person again: *Findings* now shows it, *Reports* has a PDF to download, *Notifications* show what happened.
4. As **Kabir Shah**: confirm every answer form is read-only.
5. Try the other screens: tasks and milestones, clarifications, evidence requests (ask on the engagement page, answer as the client), Data Principal requests, the audit trail.

Anything that looks wrong, confusing or missing: write it down with the screen name and what you expected. Send it to me and I will fix it before the handover.

## The AI worker (optional)

The AI Operations Centre needs the background worker to do its work. In a second terminal window in the same folder run `npm run ai:worker`. It uses the built-in rules engine; nothing leaves your computer.

## Starting again from scratch

**If you ran an earlier version of this demo, do this once**, because the demo data changed (three organisations instead of one). To wipe the local database and start clean: `docker compose -f docker-compose.local.yml down -v`, then `npm run local:db` and `npm run local:setup` again.

## Handing over to devops

Real sign-in is Supabase. Before devops deploys:

1. Do **not** give them your `.env`. They create their own from `.env.example` (see `docs/DEPLOYMENT.md`).
2. The demo sign-in is switched on only by the line `LOCAL_DEMO_AUTH=true`. It is already impossible in production (the Docker image is a production build, so with that line present the app returns an error instead of starting sign-in). Devops simply must not set it.
3. Real sign-in then works through Supabase with real accounts. This part has not been run against a live Supabase project yet, so devops should run the staging checks in `docs/DEPLOYMENT.md` sections 7 and 7a.
4. Invitations for client users still need a delivery method (there is no email yet). Decide that before go-live.
