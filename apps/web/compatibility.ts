// shared by cloudflare.config.ts and vitest.config.ts, so the deployed Worker and the tests run
// on the same workerd behaviour.

// the oldest workerd the lockfile resolves, which a guard holds it to. 2026-10-01 or later, so a
// Durable Object's pending I/O keeps it from eviction; past 2026-08-04, from which the Node.js APIs
// Better Auth imports (node:async_hooks, node:crypto) are on by the date alone
export const compatibilityDate = "2026-10-12";

// only what the date does not imply: oRPC reads `request.signal`, and the OAuth provider's client
// metadata fetches must take the public route, never this zone's origin
export const compatibilityFlags = ["enable_request_signal", "global_fetch_strictly_public"];
