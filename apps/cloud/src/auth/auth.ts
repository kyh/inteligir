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
//     and mobile sync clients already speak (`@repo/core/sync/wire`).
//
// The Expo mobile client (@better-auth/expo, added in the mobile app) drives
// email/password + bearer directly — it needs no server-side plugin here, and
// pulling @better-auth/expo into a Worker drags the whole Expo SDK into the
// bundle + a second @types/react, so it stays out. `expo://` is trusted below
// independently. If social OAuth on mobile is added later, revisit isolating
// the server expo plugin so it doesn't bloat the Worker.
//
// Secrets are runtime env, NOT hardcoded: `BETTER_AUTH_SECRET` (a DEDICATED key,
// never reused — set via `wrangler secret put`) and the optional OAuth client
// credentials. `BETTER_AUTH_URL` is the public base URL (a wrangler `var`).
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
 * Social-provider seam. Providers are enabled only when BOTH the client id and
 * secret are present in the env (set the pair via `wrangler secret put`); add a
 * new provider by mirroring the `github` branch. Returns an empty object when
 * none are configured, so nothing is passed to `betterAuth` unless real
 * credentials exist.
 */
function socialProviders(env: Env) {
  if (env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_SECRET !== undefined) {
    return {
      socialProviders: {
        github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
      },
    };
  }
  return {};
}

/** Build the request-scoped Better Auth instance from the Worker `env`. */
export function createAuth(env: Env) {
  return betterAuth({
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [bearer()],
    emailAndPassword: { enabled: true },
    trustedOrigins: trustedOrigins(env),
    ...socialProviders(env),
  });
}
