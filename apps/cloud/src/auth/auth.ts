import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { createDb } from "../db/client";

// ---------------------------------------------------------------------------
// Better Auth instance — constructed PER REQUEST because its database (D1) is a
// runtime binding, not a module singleton. `createAuth(env)` wires:
//
//   • Drizzle adapter over D1 (`provider: "sqlite"`) — auth tables live in the
//     `DB` D1 database (see ../db/schema.ts).
//   • bearer() — lets clients authenticate with `Authorization: Bearer <token>`
//     instead of a cookie. Sign-in/sign-up return the token in the
//     `set-auth-token` response header; `auth.api.getSession({ headers })` then
//     validates that bearer token in-process. This is the contract the desktop
//     and mobile sync clients already speak (`@repo/domain/sync/wire`).
//
// The Expo mobile client (@better-auth/expo, added in the mobile app) drives
// email/password + bearer directly — it needs no server-side plugin here, and
// pulling @better-auth/expo into a Worker drags the whole Expo SDK into the
// bundle + a second @types/react, so it stays out. `expo://` is trusted below
// independently. If social OAuth on mobile is added later, revisit isolating
// the server expo plugin so it doesn't bloat the Worker.
//
// Secrets are runtime env, NOT hardcoded: `BETTER_AUTH_SECRET` (a DEDICATED key, never
// reused — set via `wrangler secret put`) and the optional OAuth client
// credentials. `baseURL` is NOT configured — it's derived per-request from the
// incoming request origin (passed in by the fetch handler), so localhost,
// preview, and prod all work with zero config.
// ---------------------------------------------------------------------------

/** Extra trusted origins for cross-origin clients (desktop Electron, Expo). */
function trustedOrigins(env: Env): string[] {
  // `expo://` covers the mobile app's deep-link scheme. Additional origins
  // (e.g. the desktop app's custom protocol) can be appended via a comma-
  // separated `BETTER_AUTH_TRUSTED_ORIGINS` var without a code change.
  const extra = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  return ["expo://", ...(extra ?? [])];
}

/**
 * Social-provider seam. A provider is enabled only when BOTH its client id and
 * secret are present in the env (set the pair via `wrangler secret put`); add a
 * new provider by extending the credential table. Absent creds = the provider
 * simply doesn't exist: it's not passed to `betterAuth`, it's not listed by
 * `/v1/capabilities`, and no client renders its button.
 */
function socialCredentials(env: Env): Record<string, { clientId: string; clientSecret: string }> {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_SECRET !== undefined) {
    providers.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
  }
  if (env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined) {
    providers.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  return providers;
}

/** The social providers this deployment can actually serve — what
 * `/v1/capabilities` reports so clients render exactly the right buttons. */
export function enabledSocialProviders(env: Env): string[] {
  return Object.keys(socialCredentials(env));
}

function socialProviders(env: Env) {
  const providers = socialCredentials(env);
  return Object.keys(providers).length > 0 ? { socialProviders: providers } : {};
}

/** Build the request-scoped Better Auth instance from the Worker `env`. The
 * `baseURL` is the incoming request origin (`new URL(request.url).origin`), so
 * callback/cookie URLs match whatever host actually served the request. */
export function createAuth(env: Env, baseURL: string) {
  return betterAuth({
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    plugins: [bearer()],
    emailAndPassword: { enabled: true },
    // Persist rate-limit counters in D1. The default in-memory store keeps
    // per-isolate counters, so across Workers isolates the effective limit
    // multiplies and resets whenever an isolate recycles. 10 requests/60s per IP
    // throttles credential-stuffing against the auth routes. Cloudflare's WAF can
    // rate-limit at the edge too; this is defense-in-depth at the app layer.
    rateLimit: {
      // Off only when RATE_LIMIT_DISABLED === "true" (tests: the in-process test
      // Worker shares one IP, so a multi-user suite would trip the limiter).
      enabled: env.RATE_LIMIT_DISABLED !== "true",
      storage: "database",
      window: 60,
      max: 10,
    },
    trustedOrigins: trustedOrigins(env),
    ...socialProviders(env),
  });
}
