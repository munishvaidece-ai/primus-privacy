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
* `npm run local:setup` prepares everything: it creates your `.env` settings file, builds the tables, creates "Primus Partners" with its roles, and adds a fictional demo client with a team and sample data. You can run it again safely; it will not duplicate anything.
* `npm run dev` starts the app. Leave that window open while you test; press Ctrl+C to stop.

The next day, you only need `npm run local:db` (if Docker was restarted) and `npm run dev`.

## Signing in

The sign-in page lists everyone. The big button signs you in as **Demo Administrator**, who can do everything on the demo engagement. To see what other people see, **Log out** and pick someone else:

| Person | What they are | Use them to check |
|---|---|---|
| Demo Administrator, Priya Nair | Engagement Manager (can release findings and reports, approve discovery, validate answers) | the whole Primus side |
| Arjun Mehta | Consultant (cannot release) | what a consultant cannot do |
| Meera Iyer | Auditor | read-only view and the audit trail |
| Asha Verma | Client Administrator | the full client portal; can answer and submit |
| Rohan Gupta | Privacy Officer | same, from another client person |
| Kabir Shah | CXO / Executive Viewer | read-only: cannot answer or change anything |
| Neha Joshi | Business Owner | an engagement-level client user |

## A good test to run first

1. As **Asha Verma**: open *Discovery* and type in a few answers (they save by themselves); open *Assessment* and answer the questions. **Submit for review** is enabled only when all are answered. Submit; the answers lock.
2. As the **Demo Administrator**: open the assessment, press **Validate all answered**. Open *Findings*: the "Breach response plan untested" draft is invisible to the client; **Release** it. On the engagement page press **Release report to client**.
3. As **Asha** again: *Findings* now shows it, *Reports* has a PDF to download, *Notifications* show what happened.
4. As **Kabir Shah**: confirm every answer form is read-only.
5. Try the other screens: tasks and milestones, clarifications, evidence requests (ask on the engagement page, answer as the client), Data Principal requests, the audit trail.

Anything that looks wrong, confusing or missing: write it down with the screen name and what you expected. Send it to me and I will fix it before the handover.

## The AI worker (optional)

The AI Operations Centre needs the background worker to do its work. In a second terminal window in the same folder run `npm run ai:worker`. It uses the built-in rules engine; nothing leaves your computer.

## Starting again from scratch

To wipe the local database and start clean: `docker compose -f docker-compose.local.yml down -v`, then `npm run local:db` and `npm run local:setup` again.

## Handing over to devops

Real sign-in is Supabase. Before devops deploys:

1. Do **not** give them your `.env`. They create their own from `.env.example` (see `docs/DEPLOYMENT.md`).
2. The demo sign-in is switched on only by the line `LOCAL_DEMO_AUTH=true`. It is already impossible in production (the Docker image is a production build, so with that line present the app returns an error instead of starting sign-in). Devops simply must not set it.
3. Real sign-in then works through Supabase with real accounts. This part has not been run against a live Supabase project yet, so devops should run the staging checks in `docs/DEPLOYMENT.md` sections 7 and 7a.
4. Invitations for client users still need a delivery method (there is no email yet). Decide that before go-live.
