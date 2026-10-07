// shared by cloudflare.config.ts and vitest.config.ts, so the deployed Worker and the tests run
// on the same workerd behaviour.

// the oldest workerd the lockfile resolves; a guard holds it there
export const compatibilityDate = "2026-08-15";

// Better Auth's crypto needs node built-ins; without it the failure is runtime-only
export const compatibilityFlags = ["nodejs_compat"];
