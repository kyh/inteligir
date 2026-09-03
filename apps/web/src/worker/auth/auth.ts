import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { deleteVaultGitRepo } from "../vault/git-remote";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";
import { purgeDeviceRows } from "../device/login";
import { purgeThreadSync } from "../sync/routes";
import { sendResetEmail } from "./reset-email";

// Built per request: D1 is a runtime binding, not a module singleton. No baseURL config —
// it is derived from the request origin, so localhost, preview and prod need none.

function trustedOrigins(env: Env): string[] {
  const extra = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  return extra ?? [];
}

// redeemed_at stays set: clearing it would hand a working sign-up to whoever still holds the
// code. Case-insensitive because the gate stores the address as typed and Better Auth lowercases it.
async function forgetInviteRedeemer(env: Env, email: string): Promise<void> {
  await createDb(env.DB)
    .update(inviteCode)
    .set({ redeemedBy: null })
    .where(sql`lower(${inviteCode.redeemedBy}) = lower(${email})`);
}

export function createAuth(env: Env, baseURL: string) {
  return buildAuth(env, baseURL, true);
}

// Better Auth reads disableSignUp off the instance options with no per-call override, so the
// invite gate (./invite.ts) needs this second instance; the flag also shuts auth.api.signUpEmail.
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
      // the client requests with redirectTo "/auth/reset", so the URL's GET leg lands on ./reset-page.ts
      sendResetPassword: ({ user, url }) => sendResetEmail(env, user.email, url),
      // sessions only, not device credentials: most resets are the owner rotating a password,
      // and cutting every signed-in device would sign their own machines out; per-device revoke is the hatch
      revokeSessionsOnPasswordReset: true,
    },
    // D1 storage: the default in-memory store is per isolate, so the limit multiplies across isolates and resets on recycle
    rateLimit: {
      // off in tests: the in-process Worker shares one IP, so a multi-user suite trips it
      enabled: env.RATE_LIMIT_DISABLED !== "true",
      storage: "database",
      window: 60,
      max: 10,
    },
    user: {
      deleteUser: {
        enabled: true,
        // beforeDelete, not afterDelete: a failure aborts the deletion and the account survives to
        // retry. Credentials first: while a device row lives its credential verifies, and a request
        // landing after the purge would rebuild the object; the object's tombstone then refuses the
        // request that verified before step 1 committed.
        beforeDelete: async (user) => {
          await purgeDeviceRows(createDb(env.DB), user.id);
          await deleteVaultGitRepo(env, user.id);
          await purgeThreadSync(env, user.id);
          await forgetInviteRedeemer(env, user.email);
        },
      },
    },
    trustedOrigins: trustedOrigins(env),
  });
}
