// Test-only shim for the `server-only` package. That package's real
// implementation unconditionally throws unless the bundler applies
// Next.js's own special "server" resolve condition — a build-time-only
// guard against accidentally bundling a server module into client-side
// JavaScript, with no runtime authorization/security behavior of its own
// to test. Vitest has no such resolve condition, so importing the real
// package here would always throw regardless of whether the module
// under test is genuinely server-only or not — this shim (aliased in
// vitest.config.ts, for tests only; the real Next.js build in
// package.json's own "build" script continues to use the real npm
// package and its real enforcement) exists solely so the actual
// authorization/session/domain logic in lib/** can be imported and
// tested directly, unmodified, exactly as the real application runs it.
export {};
