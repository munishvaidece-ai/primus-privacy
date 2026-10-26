// The local demo sign-in must be impossible to leave on by accident.
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoAuthProblem } from "@/lib/auth/demo-auth-rules";
import { DemoAuthMisconfiguredError, isDemoAuthActive } from "@/lib/auth/demo-auth";

const local = { NODE_ENV: "development", DATABASE_URL: "postgres://postgres:postgres@localhost:5433/primus_local" };

describe("demo sign-in safety rules", () => {
  it("is allowed only for a development build with a database on this computer and no Supabase", () => {
    expect(demoAuthProblem(local)).toBeNull();
    expect(demoAuthProblem({ ...local, DATABASE_URL: "postgres://u:p@127.0.0.1:5432/x" })).toBeNull();
    expect(demoAuthProblem({ ...local, DATABASE_URL: "postgres://u:p@[::1]:5432/x" })).toBeNull();
  });
  it("is refused in a production build", () => {
    expect(demoAuthProblem({ ...local, NODE_ENV: "production" })).toMatch(/production/);
  });
  it("is refused when the database is not on this computer", () => {
    for (const host of ["db.example.com", "10.0.0.5", "xyz.supabase.co", "localhost.evil.com"]) {
      expect(demoAuthProblem({ ...local, DATABASE_URL: `postgres://u:p@${host}:5432/x` }), host).toMatch(/this computer/);
    }
    expect(demoAuthProblem({ NODE_ENV: "development" })).toMatch(/this computer/);
    expect(demoAuthProblem({ ...local, DATABASE_URL: "not a url" })).toMatch(/this computer/);
  });
  it("is refused when Supabase is configured", () => {
    expect(demoAuthProblem({ ...local, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toMatch(/Supabase/);
  });
});

describe("isDemoAuthActive", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("is off unless LOCAL_DEMO_AUTH is exactly true", () => {
    vi.stubEnv("LOCAL_DEMO_AUTH", "");
    expect(isDemoAuthActive()).toBe(false);
    vi.stubEnv("LOCAL_DEMO_AUTH", "TRUE");
    expect(isDemoAuthActive()).toBe(false);
    vi.stubEnv("LOCAL_DEMO_AUTH", "1");
    expect(isDemoAuthActive()).toBe(false);
  });
  it("is on locally when asked for", () => {
    vi.stubEnv("LOCAL_DEMO_AUTH", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", local.DATABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(isDemoAuthActive()).toBe(true);
  });
  it("fails closed, with a clear error, if it is switched on in production or against a remote database", () => {
    vi.stubEnv("LOCAL_DEMO_AUTH", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("DATABASE_URL", local.DATABASE_URL);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => isDemoAuthActive()).toThrow(DemoAuthMisconfiguredError);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.prod.example.com:5432/x");
    expect(() => isDemoAuthActive()).toThrow(/this computer/);
  });
});
