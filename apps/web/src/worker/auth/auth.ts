import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { deleteVaultGitRepo } from "../vault/git-remote";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";
import { purgeDeviceRows } from "../device/pairing";
import { purgeThreadSync } from "../sync/routes";
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

/** Extra trusted origins, appended via a comma-separated
 * `BETTER_AUTH_TRUSTED_ORIGINS` var without a code change. */
function trustedOrigins(env: Env): string[] {
  const extra = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  return extra ?? [];
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

/** The providers this deployment can be configured for — each present only
 *  when both of its secrets are bound. */
type SocialProviders = {
  github?: SocialCredential;
  google?: SocialCredential;
};

function socialCredentials(env: Env): SocialProviders {
  const providers: SocialProviders = {};
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
      // A reset kills every other live session, so a possibly-stolen bearer
      // dies with it. SESSIONS ONLY, not device credentials — deliberately:
      // most resets are the owner rotating a password, and cutting every
      // paired device would unpair their own machines each time. The
      // stolen-device hatch is the dashboard's per-device revoke, which
      // bites on the next request. The residual, stated: a reset after a
      // full takeover leaves an attacker-paired device syncing until the
      // owner revokes it from Devices.
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
        // BEFORE, not after: a failure here aborts the whole deletion, the
        // account survives, and every step is idempotent — pressing the button
        // again resumes it. `afterDelete` would run once the account row is
        // already gone, leaving data behind with no account left to ask again.
        //
        // THE ORDER IS THE POINT, and it runs credentials-first:
        //
        //   1. The device and pairing rows. While one lives its credential
        //      still verifies, so purging the object first leaves a window in
        //      which an authenticated request lands AFTER the purge and
        //      rebuilds exactly what was deleted. Killing the credentials
        //      first means no NEW request can even name the object.
        //   2. The hosted vault repo — the only note bytes the cloud ever
        //      holds.
        //   3. The object itself, which closes its sockets, drops its storage
        //      and tombstones itself. The tombstone is what closes the
        //      remaining race: a request that verified microseconds before
        //      step 1 committed can still be in flight, and it is refused on
        //      arrival rather than served into an empty object.
        //   4. The invite's redeemer email — the one thing the user typed that
        //      lives outside all of the above.
        beforeDelete: async (user) => {
          await purgeDeviceRows(createDb(env.DB), user.id);
          await deleteVaultGitRepo(env, user.id);
          await purgeThreadSync(env, user.id);
          await forgetInviteRedeemer(env, user.email);
        },
      },
    },
    trustedOrigins: trustedOrigins(env),
    ...socialProviders(env),
  });
}
