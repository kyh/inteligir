import { betterAuth } from "better-auth";
// the adapter better-auth re-exports reads `db._.fullSchema`, gone in drizzle 1.0; relations-v2
// reads `db._.relations`, which `createDb` populates.
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
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

const trustedOrigins = (env: Env): string[] => {
  const extra = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  return extra ?? [];
};

// redeemed_at stays set: clearing it would hand a working sign-up to whoever still holds the
// code. Case-insensitive because the gate stores the address as typed and Better Auth lowercases it.
const forgetInviteRedeemer = async (env: Env, email: string): Promise<void> => {
  await createDb(env.DB)
    .update(inviteCode)
    .set({ redeemedBy: null })
    .where(sql`lower(${inviteCode.redeemedBy}) = lower(${email})`);
};

const buildAuth = (env: Env, baseURL: string, disableSignUp: boolean) =>
  betterAuth({
    baseURL,
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite" }),
    emailAndPassword: {
      disableSignUp,
      enabled: true,
      // sessions only, not device credentials: most resets are the owner rotating a password,
      // and cutting every signed-in device would sign their own machines out; per-device revoke is the hatch
      revokeSessionsOnPasswordReset: true,
      // the client requests with redirectTo "/auth/reset", so the URL's GET leg lands on ./reset-page.ts
      sendResetPassword: async ({ user, url }) => {
        await sendResetEmail(env, user.email, url);
      },
    },
    plugins: [bearer()],
    // D1 storage: the default in-memory store is per isolate, so the limit multiplies across isolates and resets on recycle
    rateLimit: {
      // off in tests: the in-process Worker shares one IP, so a multi-user suite trips it
      enabled: env.RATE_LIMIT_DISABLED !== "true",
      max: 10,
      storage: "database",
      window: 60,
    },
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(env),
    user: {
      deleteUser: {
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
        enabled: true,
      },
    },
  });

export const createAuth = (env: Env, baseURL: string) => buildAuth(env, baseURL, true);

// Better Auth reads disableSignUp off the instance options with no per-call override, so the
// invite gate (./invite.ts) needs this second instance; the flag also shuts auth.api.signUpEmail.
export const createSignUpAuth = (env: Env, baseURL: string) => buildAuth(env, baseURL, false);
