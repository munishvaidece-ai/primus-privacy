-- PRIMUS PRIVACY — Migration 0018: Organisation audit trigger.
--
-- Hand-written (DECISIONS.md R-02) — a single `CREATE TRIGGER`, no new
-- table, no new column, no new function, no domain/schema redesign.
--
-- Closes a real, pre-existing gap discovered while implementing Slice B1
-- (Organisation Creation + Detail), not introduced by it: SECURITY.md §6
-- lists "Engagement and Client record changes" among the material
-- changes requiring an `audit_log` entry, and Slice B1 instructions §10
-- require organisation creation to be auditable "using the existing
-- audit mechanism... do not create a second audit system" — but no
-- audit trigger was ever wired onto `organisations` in migration 0001.
-- Confirmed by direct inspection, not assumed: `grep`ing every migration
-- file (0000-0017) for a trigger on `"organisations"` finds only
-- `organisations_prevent_reparenting` (migration 0001) — no
-- `organisations_audit_log` trigger exists anywhere, and `organisations`
-- has carried this gap since Milestone 1, unnoticed until a feature that
-- actually needed it (this slice) was built.
--
-- Reuses `log_methodology_change()` (introduced migration 0007, reused
-- unchanged by every milestone since) exactly as-is — no new mechanism.
-- It requires only `NEW.tenant_id`/`NEW.id`, which `organisations`
-- already carries directly, the same shape every other table using this
-- function has. `AFTER INSERT OR UPDATE` (not INSERT-only) matches the
-- convention used for every other ordinarily-mutable, non-append-only
-- entity (e.g. `maturity_domains_audit_log`) — Slice B1 itself only
-- performs INSERTs, but this makes the trigger already correct for
-- whenever a future slice adds organisation editing (Slice B1
-- instructions §9 explicitly defer that), with no further migration
-- needed for auditing it.
--
-- Deliberately NOT extended to `engagements` here, which carries the
-- identical gap (confirmed by the same grep) — Slice B1 does not create
-- or update any `engagements` row at all (out of this slice's own
-- explicit scope, instructions §18); left for whichever future slice
-- actually builds engagement creation/editing. See DECISIONS.md.

CREATE TRIGGER organisations_audit_log
  AFTER INSERT OR UPDATE ON "organisations"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
