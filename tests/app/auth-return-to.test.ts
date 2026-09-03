// P2B.5 — Client Onboarding & Acceptance UX. Pure-function tests for
// `safeReturnTo` (lib/auth/return-to.ts) — the open-redirect guard
// `signIn`/`signOut` (lib/auth/actions.ts) use before ever calling
// `redirect()` with a caller-supplied destination.
import { describe, expect, it } from "vitest";
import { safeReturnTo } from "@/lib/auth/return-to";

describe("safeReturnTo (P2B.5 open-redirect guard)", () => {
  it("accepts an ordinary same-origin absolute path", () => {
    expect(safeReturnTo("/invite/abc123")).toBe("/invite/abc123");
    expect(safeReturnTo("/organisations")).toBe("/organisations");
    expect(safeReturnTo("/organisations/00000000-0000-0000-0000-000000000000")).toBe(
      "/organisations/00000000-0000-0000-0000-000000000000",
    );
  });

  it("rejects a protocol-relative URL (the classic open-redirect vector)", () => {
    expect(safeReturnTo("//evil.example")).toBeNull();
    expect(safeReturnTo("//evil.example/phish")).toBeNull();
  });

  it("rejects a full external URL with a scheme", () => {
    expect(safeReturnTo("https://evil.example")).toBeNull();
    expect(safeReturnTo("http://evil.example/invite/abc")).toBeNull();
    expect(safeReturnTo("javascript:alert(1)")).toBeNull();
  });

  it("rejects a backslash-prefixed path (browser-normalization trick some parsers treat as //)", () => {
    expect(safeReturnTo("/\\evil.example")).toBeNull();
  });

  it("rejects a value that doesn't start with a single slash", () => {
    expect(safeReturnTo("evil.example")).toBeNull();
    expect(safeReturnTo("")).toBeNull();
  });

  it("rejects non-string/absent input", () => {
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(undefined)).toBeNull();
  });

  it("accepts a FormDataEntryValue that is a string, and rejects one that would be a File", () => {
    const fd = new FormData();
    fd.set("returnTo", "/invite/abc");
    expect(safeReturnTo(fd.get("returnTo"))).toBe("/invite/abc");

    const fd2 = new FormData();
    fd2.set("returnTo", new Blob(["x"]), "file.txt");
    // A File is a valid FormDataEntryValue but not a string — must be
    // rejected, not coerced.
    expect(safeReturnTo(fd2.get("returnTo"))).toBeNull();
  });
});
