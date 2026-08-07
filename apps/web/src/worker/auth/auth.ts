import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { createDb } from "../db/client";
import { sendResetEmail } from "./reset-email";

// ---------------------------------------------------------------------------
// Better Auth instance — constructed PER REQUEST because its database (D1) is a
// runtime binding, not a module singleton. `createAuth(env)` wires:
//
//   • Drizzle adapter over D1 (`provider: "sqlite"`) — auth tables live in the
//     `DB` D1 database (see ../db/schema.ts).
//   • bearer() — lets clients authenticate with `Authorization: Bearer <token>`
//     instead of a cookie. Sign-in/sign-up return the token in the
//     `set-auth-token` response header; `auth.api.getSession({ headers })` then
//     validates that bearer token in-process — the contract every client
//     speaks, since none of them carries cookies.
//
// Secrets are runtime env, NOT hardcoded: `BETTER_AUTH_SECRET` (a DEDICATED key, never
// reused — set via `wrangler secret put`) and the optional OAuth client
// credentials. `baseURL` is NOT configured — it's derived per-request from the
// incoming request origin (passed in by the fetch handler), so localhost,
// preview, and prod all work with zero config.
// ---------------------------------------------------------------------------

/** Extra trusted origins for the native clients' own schemes. */
function trustedOrigins(env: Env): string[] {
  // `expo://` is the mobile app's deep-link scheme and `inteligir://` the
  // desktop shell's — the redirect targets a native social flow would have to
  // name. More origins can be appended via a comma-separated
  // `BETTER_AUTH_TRUSTED_ORIGINS` var without a code change.
  const extra = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  return ["expo://", "inteligir://", ...(extra ?? [])];
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
    emailAndPassword: {
      enabled: true,
      // Password reset: Better Auth mints the token + URL and calls
      // this to deliver it (Cloudflare Email Sending; absorbs its own
      // failures — see reset-email.ts). The desktop requests with
      // `redirectTo: "/auth/reset"`, so the URL's GET leg redirects to the
      // Worker-hosted reset page (see ./reset-page.ts) with `?token=`.
      sendResetPassword: ({ user, url }) => sendResetEmail(env, user.email, url),
      // A reset is usually "I lost control of this account" recovery — kill
      // every other live session so a possibly-stolen bearer dies with it.
      revokeSessionsOnPasswordReset: true,
    },
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
