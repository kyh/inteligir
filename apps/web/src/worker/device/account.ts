import { eq } from "drizzle-orm";
import { createAuth } from "../auth/auth";
import type { Db } from "../db/client";
import { session, user } from "../db/schema";
import { signInWithPassword } from "./login";

const accountRow = async (db: Db, userId: string) =>
  await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).get();

// "gone" is a live credential with no user row: the deletion race's in-flight sliver, answered as
// the tombstone would answer it
type AccountDeletion = "deleted" | "invalid-credentials" | "gone";

// `account.delete` (`../wire/account-router.ts`) asks the password again, and a device holds no
// browser session, which is all Better Auth's own deleteUser takes: the password mints one here,
// and deleteUser runs under its cookie, so its beforeDelete order and tombstone stay the one purge
// path
export const deleteAccountWithPassword = async (
  env: Env,
  exports: Cloudflare.Exports,
  db: Db,
  request: { readonly origin: string; readonly userId: string; readonly password: string },
): Promise<AccountDeletion> => {
  const row = await accountRow(db, request.userId);
  if (row === undefined) {
    return "gone";
  }
  const auth = createAuth(env, exports, request.origin);
  const signedIn = await signInWithPassword(auth, row.email, request.password);
  if (signedIn === null) {
    return "invalid-credentials";
  }
  try {
    // no password in the body: the sign-in just checked it, and the session it minted is fresh
    await auth.api.deleteUser({ body: {}, headers: signedIn.sessionCookie });
  } finally {
    // a deletion that aborted leaves the sign-in's session behind, a cookie nobody holds
    await db.delete(session).where(eq(session.token, signedIn.token));
  }
  return "deleted";
};
