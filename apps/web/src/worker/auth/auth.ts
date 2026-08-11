import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";
import { userHostName } from "../host/host-address";
import { sendResetEmail } from "./reset-email";

// ---------------------------------------------------------------------------
// Better Auth instance — constructed PER REQUEST because its database (D1) is a
// runtime binding, not a module singleton. `createAuth(env)` wires:
//
//   • Drizzle adapter over D1 (`provider: "sqlite"`) — auth tables live in the
//     `DB` D1 database (see ../db/schema.ts).
//   • `emailAndPassword.disableSignUp` — ON for every caller but the invite
//     gate, which builds its own instance with it off (see `createSignUpAuth`).
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
  // shell's — the redirect targets a native social flow would have to name.
  // More origins can be appended via a comma-separated
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
 *
 * Every one of them carries `disableSignUp`, because a provider is a SIGN-IN
 * for an account that already linked it and never a way to get one. Without it
 * the invite gate would hold only the door it was built on: an OAuth callback
 * creates an account from the provider's own profile, having asked no code, and
 * the gate would be a fact about email+password rather than about sign-up.
 * Existing users keep signing in — the flag refuses only the register branch.
 */
type SocialCredential = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly disableSignUp: true;
};

function socialCredentials(env: Env): Record<string, SocialCredential> {
  const providers: Record<string, SocialCredential> = {};
  if (env.GITHUB_CLIENT_ID !== undefined && env.GITHUB_CLIENT_SECRET !== undefined) {
    providers.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      disableSignUp: true,
    };
  }
  if (env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      disableSignUp: true,
    };
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

/**
 * Drop the deleted account's email from the invite it spent — the one thing a
 * user typed that lives outside their own object, and so the one thing
 * `purgeAccount` cannot reach.
 *
 * `redeemed_at` STAYS SET. It is what marks the code burned; clearing it would
 * hand a working sign-up to whoever still has the string, so "delete
 * everything" would re-open the door the deleted account came through.
 *
 * Matched case-insensitively because the two sides disagree by design: the gate
 * records the address as it was typed, and Better Auth stores the user row's
 * email lowercased.
 */
async function forgetInviteRedeemer(env: Env, email: string): Promise<void> {
  await createDb(env.DB)
    .update(inviteCode)
    .set({ redeemedBy: null })
    .where(sql`lower(${inviteCode.redeemedBy}) = lower(${email})`);
}

/** Build the request-scoped Better Auth instance from the Worker `env`. The
 * `baseURL` is the incoming request origin (`new URL(request.url).origin`), so
 * callback/cookie URLs match whatever host actually served the request. This is
 * what every route builds, so `/api/auth/sign-up/email` REFUSES on it. */
export function createAuth(env: Env, baseURL: string) {
  return buildAuth(env, baseURL, true);
}

/**
 * The one instance that can create an account, built only by the invite gate's
 * forward (./invite.ts).
 *
 * Sign-up is closed by CONFIGURATION rather than by a route table, because
 * Better Auth reads `disableSignUp` off the options its sign-up endpoint runs
 * under — so the same flag shuts `auth.api.signUpEmail` and every other way
 * into that endpoint, not just the HTTP path. Which is also why the gate needs
 * a second instance: there is no per-call override, and the forward is what
 * returns Better Auth's own response — `set-cookie`, `set-auth-token` and every
 * validation error — untouched.
 */
export function createSignUpAuth(env: Env, baseURL: string) {
  return buildAuth(env, baseURL, false);
}

function buildAuth(env: Env, baseURL: string, disableSignUp: boolean) {
  return betterAuth({
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    plugins: [bearer()],
    emailAndPassword: {
      enabled: true,
      disableSignUp,
      // Password reset: Better Auth mints the token + URL and calls
      // this to deliver it (Cloudflare Email Sending; absorbs its own
      // failures — see reset-email.ts). A client requests with
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
    user: {
      deleteUser: {
        enabled: true,
        // BEFORE, not after. Everything the user made is in their Durable
        // Object and under their R2 prefix, and `afterDelete` runs once the
        // account row is already gone — so a purge that failed there would
        // leave data with no account to ask for it again. Here a failure aborts
        // the whole deletion: the account survives, both steps below are
        // idempotent, and pressing the button again resumes it.
        //
        // Better Auth has already checked the password (or the session's
        // freshness) by the time this runs, which is what makes naming the
        // object safe — see UserHost.purgeAccount.
        beforeDelete: async (user) => {
          await env.UserHost.getByName(userHostName(user.id)).purgeAccount();
          await forgetInviteRedeemer(env, user.email);
        },
      },
    },
    trustedOrigins: trustedOrigins(env),
    ...socialProviders(env),
  });
}
