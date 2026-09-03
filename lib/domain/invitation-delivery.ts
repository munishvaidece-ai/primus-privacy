import "server-only";

// P2B.3 (Invitation Creation & Secure Token Lifecycle): the boundary
// between invitation creation and however a raw invitation token is
// ever actually delivered to its recipient. No email/notification
// abstraction exists anywhere in this codebase yet (grepped fresh this
// slice: zero references to any mail/notification library or
// abstraction) — this is the smallest possible one, not a
// general-purpose notification architecture. Exactly one method, taking
// exactly the fields a real delivery mechanism (a future email
// provider) would need.
//
// The load-bearing invariant this boundary exists to enforce:
// `lib/domain/invitations.ts` generates the raw invitation token, hands
// it to whichever adapter `getInvitationDeliveryAdapter()` selects, and
// then it goes out of scope — it is never written back to the
// `invitations` row (only its SHA-256 hash is, by `createInvitation`
// itself, before this boundary is ever reached), never logged, and
// never returned through `createInvitation`'s own return value. Only
// the adapter actually selected here ever sees the raw token.
//
// P2B.3 does NOT integrate a real email provider (Resend/SendGrid/AWS
// SES/etc.) and does NOT send real email — explicitly out of this
// slice's scope. The ONLY adapter implemented is a development/test
// stand-in that captures the payload in memory, clearly named and
// documented as such, never masquerading as production delivery —
// mirroring the exact "real once configured, local/test stand-in
// otherwise" shape `lib/storage/evidence-storage.ts`'s own
// `getEvidenceStorageAdapter()` already established for Evidence
// Storage, so a future real provider slots in behind the SAME selector
// function without any caller of `getInvitationDeliveryAdapter()`
// changing.

export interface InvitationDeliveryPayload {
  invitationId: string;
  invitedEmail: string;
  /** Contains the raw, one-time bearer token — never `token_hash`,
   * never persisted anywhere by this module or its caller. */
  invitationUrl: string;
  expiresAt: Date;
}

export interface InvitationDeliveryAdapter {
  deliver(payload: InvitationDeliveryPayload): Promise<void>;
}

/**
 * Development/test stand-in — the ONLY adapter this slice implements.
 * Captures each delivery payload in memory (never to disk, never to any
 * log, never to `console`) so tests can assert on token/URL-handling
 * invariants without a real email provider existing. This is clearly
 * NOT production email delivery: nothing here sends anything anywhere,
 * and nothing outside this module's own test-only accessors can read a
 * captured payload back.
 */
class DevInvitationDeliveryAdapter implements InvitationDeliveryAdapter {
  private deliveries: InvitationDeliveryPayload[] = [];

  async deliver(payload: InvitationDeliveryPayload): Promise<void> {
    // Deliberately no console/logger call of any kind here — see this
    // module's own header: the raw token (embedded in `invitationUrl`)
    // must never reach a generic log.
    this.deliveries.push(payload);
  }

  /** Test-only: every payload captured so far, oldest first. */
  getCapturedDeliveries(): readonly InvitationDeliveryPayload[] {
    return this.deliveries;
  }

  /** Test-only: resets captured state between test files/suites. */
  clear(): void {
    this.deliveries = [];
  }
}

let cachedAdapter: DevInvitationDeliveryAdapter | undefined;

/**
 * Always returns the Dev stand-in today — there is no real provider yet
 * to select between (unlike `getEvidenceStorageAdapter`, which already
 * has two real implementations). The selector shape is kept identical
 * anyway so introducing a real provider later is a change to this ONE
 * function, not to `createInvitation` or any other caller.
 */
export function getInvitationDeliveryAdapter(): InvitationDeliveryAdapter {
  if (!cachedAdapter) {
    cachedAdapter = new DevInvitationDeliveryAdapter();
  }
  return cachedAdapter;
}

/**
 * Test-only accessor to the Dev adapter's own captured-deliveries API —
 * narrows the interface-typed `getInvitationDeliveryAdapter()` result
 * back to the concrete Dev type tests need, without exposing
 * `getCapturedDeliveries()`/`clear()` on the public
 * `InvitationDeliveryAdapter` interface itself (a real future provider
 * would not implement them).
 */
export function getDevInvitationDeliveryAdapter(): DevInvitationDeliveryAdapter {
  const adapter = getInvitationDeliveryAdapter();
  if (!(adapter instanceof DevInvitationDeliveryAdapter)) {
    throw new Error("No dev invitation delivery adapter is active.");
  }
  return adapter;
}
