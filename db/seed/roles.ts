// Seeds the role/permission taxonomy documented in PRODUCT_SPEC.md §2.
// This is reference/taxonomy data (part of the schema itself, like a
// country-code list), not application "mock data" — Milestone 1
// instructions §12 explicitly distinguishes the two. Idempotent: safe to
// run more than once.
import "dotenv/config";
import { Pool } from "pg";

const ROLES: Array<{ name: string; scope: "tenant" | "organisation" | "engagement"; description: string }> = [
  // PRIMUS-side
  { name: "Platform Administrator", scope: "tenant", description: "Operates the platform itself: client organisation provisioning, global role/permission configuration, control library and regulatory content management." },
  { name: "Practice Partner", scope: "tenant", description: "Practice-wide oversight: engagement economics, quality sign-off, cross-engagement visibility within the practice." },
  { name: "Engagement Manager", scope: "engagement", description: "Owns delivery of one or more engagements: scoping, staffing, timeline, client relationship, final report sign-off." },
  { name: "Consultant", scope: "engagement", description: "Does the engagement work: discovery, data landscape build-out, assessments, control testing, findings, remediation tracking." },
  { name: "Auditor", scope: "engagement", description: "Independent, practice-internal quality reviewer of engagement work products before they reach the client." },
  // Client-side
  { name: "Client Administrator", scope: "organisation", description: "Manages the client organisation's own users and access on the platform." },
  { name: "Privacy Officer", scope: "organisation", description: "Primary client-side owner of the compliance programme; broadest client-side visibility." },
  { name: "CXO / Executive Viewer", scope: "organisation", description: "Read-only, summary/dashboard-level visibility for governance reporting." },
  { name: "Business Owner", scope: "engagement", description: "Owns specific processing activities / business units; provides input, accepts remediation ownership." },
  { name: "IT/CISO", scope: "engagement", description: "Owns systems, data stores, technical controls and technical evidence." },
  { name: "Procurement", scope: "engagement", description: "Owns processor/vendor relationships and contracts (DPAs)." },
  { name: "Legal", scope: "engagement", description: "Reviews legal-adjacent artifacts: notices, contracts, regulatory interpretation notes." },
];

// A small, representative permission set — NOT an exhaustive catalogue
// (Milestone 1 instructions §3: "Do not overbuild the permission-
// management UI"). Enough to prove RolePermission works end to end.
//
// Slice C7.3 (DECISIONS.md R-117) adds `assessment.finalize` — a
// genuinely new permission row, additive seed data only (no schema
// change; `permissions`/`role_permissions` already existed since
// Milestone 1). PRODUCT_UX_BLUEPRINT.md §8's own permission-mapping
// table names "finalize" and "membership-manage" as the two distinct
// capabilities Engagement Manager gets beyond an ordinary Consultant —
// the same distinct-permission shape `membership.manage` already used
// for the second one (Slice C7.2), applied here for the first.
//
// Slice D1 (Control Library Authoring) adds `methodology.manage` —
// resolved from PRODUCT_UX_BLUEPRINT.md §8's own Permission Matrix,
// whose "Methodology (Control Library / Risk Model / Maturity
// Methodology)" row gives the "Tenant" column full R,C,E,F, and whose
// own legend maps "Tenant" to exactly "Platform Administrator, Practice
// Partner" — not a new ownership model, the existing one (methodology
// is Tenant/practice-owned, migration 0007), given its first dedicated
// permission rather than the coarse `is_active_tenant_member` check
// every tenant-scope Role previously shared undifferentiated (see
// migration 0026 and DECISIONS.md).
//
// Slice D3 (Applicability & Scope) adds `scope.lock` — a genuinely NEW,
// DEDICATED permission (D3 approval, Change 3), deliberately NOT a
// reuse of `assessment.finalize` even though both are granted to the
// same seeded role today: "scope.lock" means the Engagement's own
// applicability/scope determination is settled; "assessment.finalize"
// means one Assessment instance is certified — two independently
// meaningful, independently revisable product actions that happen to
// currently share an owner (Engagement Manager, "final report
// sign-off" — db/seed/roles.ts's own pre-existing description), not one
// action wearing two names. See DECISIONS.md.
//
// M2 (Maturity Implementation) adds `maturity.compute` — the M2
// approval's own §20, explicit: a dedicated permission, NOT a reuse of
// `assessment.finalize` or `scope.lock` even though all three currently
// share an owner (Engagement Manager). Unlike `scope.lock`, M2 §3/§20
// treat "compute" and "finalize" as ONE atomic action (`computeAndFinalize
// MaturityAssessment`, lib/domain/maturity.ts) with no separate human
// review step for MVP, so a single permission covers both — there is no
// second "maturity.finalize" permission to seed.
const PERMISSIONS: Array<{ key: string; description: string }> = [
  { key: "tenant.manage", description: "Manage tenant-level settings." },
  { key: "organisation.create", description: "Onboard a new client organisation under the tenant." },
  { key: "organisation.manage", description: "Edit an existing client organisation's details." },
  { key: "engagement.create", description: "Open a new engagement for a client." },
  { key: "engagement.manage", description: "Edit an existing engagement's details/status." },
  { key: "membership.manage", description: "Grant or revoke tenant/organisation/engagement memberships." },
  { key: "user.manage", description: "Manage user profiles and status." },
  { key: "audit_log.read", description: "Read the audit log." },
  { key: "assessment.finalize", description: "Finalize an Assessment, freezing its responses/tests/evidence permanently." },
  { key: "methodology.manage", description: "Author and publish the practice's regulatory content and control library." },
  { key: "scope.lock", description: "Permanently lock an Engagement's Applicability & Scope determination." },
  { key: "maturity.compute", description: "Compute and finalize a MaturityAssessment for a finalized Assessment." },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  "Platform Administrator": [
    "tenant.manage",
    "organisation.create",
    "organisation.manage",
    "engagement.create",
    "engagement.manage",
    "membership.manage",
    "user.manage",
    "audit_log.read",
    "assessment.finalize",
    "methodology.manage",
  ],
  "Practice Partner": ["organisation.create", "engagement.create", "engagement.manage", "audit_log.read", "methodology.manage"],
  "Engagement Manager": ["engagement.manage", "membership.manage", "assessment.finalize", "scope.lock", "maturity.compute"],
  "Client Administrator": ["membership.manage", "user.manage"],
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const roleIds = new Map<string, string>();
    for (const role of ROLES) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO roles (name, scope, description, is_system_defined)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
        [role.name, role.scope, role.description],
      );
      roleIds.set(role.name, result.rows[0]!.id);
    }

    const permissionIds = new Map<string, string>();
    for (const permission of PERMISSIONS) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO permissions (key, description)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
        [permission.key, permission.description],
      );
      permissionIds.set(permission.key, result.rows[0]!.id);
    }

    for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
      const roleId = roleIds.get(roleName);
      if (!roleId) continue;
      for (const key of permissionKeys) {
        const permissionId = permissionIds.get(key);
        if (!permissionId) continue;
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, permissionId],
        );
      }
    }

    await client.query("COMMIT");
    console.log(`Seeded ${ROLES.length} roles, ${PERMISSIONS.length} permissions.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
