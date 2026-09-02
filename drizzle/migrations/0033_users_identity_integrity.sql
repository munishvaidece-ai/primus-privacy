-- PRIMUS PRIVACY — Migration 0033: users identity/tenancy integrity
-- hardening (P2B.0.2).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- prior security/hardening migration (DECISIONS.md R-02): a BEFORE
-- UPDATE guard trigger isn't modeled in the Drizzle TS schema. Assumes
-- migrations 0000-0032 are already applied.
--
-- P2B.0.1 (docs/P2B.0.1_SECURITY_CLARIFICATIONS.md §2a) empirically
-- confirmed, live, against the real running system: `GRANT SELECT,
-- UPDATE ON "users" TO authenticated` (migration 0001) is unrestricted
-- by column, and `users_update_self`'s RLS policy
-- (`USING (id = auth.uid()) WITH CHECK (id = auth.uid())`) checks only
-- ROW identity, never which COLUMNS changed. Together these let any
-- ordinary authenticated user change their OWN `tenant_id`,
-- `client_org_id`, `email`, or `status` via a plain UPDATE statement —
-- confirmed by a live, rolled-back test moving a user from one tenant
-- to a completely unrelated one. This predates P2B and is not
-- introduced by it, but P2B's own invitation-acceptance design depends
-- on trusting `client_org_id` (and, transitively, `email`), so it must
-- be closed first — see docs/P2B.0.1_SECURITY_CLARIFICATIONS.md for
-- the full analysis.
--
-- This is exactly the same class of gap `engagement_memberships_
-- prevent_reparenting` (migration 0024), `prevent_engagement_
-- reparenting`/`prevent_organisation_reparenting` (migration 0001),
-- and every other tampering-guard trigger in this codebase already
-- closes for their own tables — `users` is the one foundational table
-- that never got one. The fix mirrors that exact, established pattern:
-- a `BEFORE UPDATE` trigger blocking specific dangerous columns, not a
-- blanket "no self-update at all" rule and not a new authorization
-- framework.
--
-- Column classification (see docs/P2B.0.1_SECURITY_CLARIFICATIONS.md
-- and the accompanying db/schema/users.ts comment):
--   A. Immutable identity/tenancy — `id`, `tenant_id`, `client_org_id`:
--      set once, at provisioning, by `handle_new_auth_user`; never
--      legitimately change afterward, by anyone, through ordinary
--      means.
--   B. Legitimately self-editable — `display_name`, `updated_at`: no
--      feature in this codebase currently edits these (confirmed by
--      exhaustive grep: zero `db.update(users)`/`db.insert(users)`
--      call sites anywhere in `lib/`/`app/` — the ONLY writers of this
--      table today are the two triggers below), but nothing about
--      P2B.0.2's own scope requires closing them off, and `users.ts`'s
--      own header already frames `display_name` as exactly the kind of
--      "platform-specific profile field" a future self-service edit
--      would touch. Left open, at zero cost, rather than closed for a
--      feature that doesn't exist yet.
--   C. Server-controlled, not self-editable — `status`: reserved for a
--      future, dedicated, `user.manage`-gated privileged action (not
--      built — out of scope here, per docs/P2B.0.1_SECURITY_
--      CLARIFICATIONS.md's own explicit non-goal); never settable by
--      the row's own owner.
--   D. Auth-authoritative — `email`: Supabase Auth owns this identity;
--      `public.users.email` may change ONLY via the existing
--      `handle_auth_user_email_change` trigger (migration 0001),
--      itself driven by a real `auth.users.email` change — never
--      directly, by anyone, through the `authenticated`-role UPDATE
--      path.
--   Also protected, for audit-integrity: `created_at` — a historical
--   fact, not intended to ever change post-creation.
--
-- Distinguishing the legitimate sync path from an ordinary
-- authenticated self-update: `handle_auth_user_email_change` is itself
-- `SECURITY DEFINER` (migration 0001) — for the duration of its
-- execution, and for any trigger it fires as a side effect of its own
-- UPDATE, `current_user` is that function's OWNER, never `authenticated`
-- (standard, documented PostgreSQL SECURITY DEFINER behavior — the
-- same privilege-context change this codebase's own comments already
-- rely on to explain why these functions are marked SECURITY DEFINER
-- in the first place). Every legitimate writer of this table — the
-- provisioning/email-sync triggers, migration/fixture tooling, any
-- future privileged server-side operation — therefore runs as
-- something other than `authenticated`. The guard below checks for
-- exactly that one role, precisely, rather than trying to enumerate
-- every legitimate caller.

CREATE OR REPLACE FUNCTION public.prevent_user_identity_tampering()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'authenticated' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.client_org_id IS DISTINCT FROM OLD.client_org_id
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION
      'users.{id,tenant_id,client_org_id,email,status,created_at} are immutable via ordinary self-update (user %); tenant/organisation are set once at provisioning, email is synced from auth.users only, status changes require a dedicated privileged path that does not exist yet'
      , OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_prevent_identity_tampering
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_user_identity_tampering();

-- No GRANT/RLS-policy change — `users_update_self`'s existing row-level
-- scoping (`id = auth.uid()`) is correct and unweakened; this trigger
-- adds the missing column-level layer underneath it, the same
-- belt-and-suspenders relationship every other reparenting guard in
-- this codebase already has with its own table's RLS policy.
