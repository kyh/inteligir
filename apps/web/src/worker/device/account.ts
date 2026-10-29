import {
  ACCOUNT_API_PATHS,
  deleteAccountRequestSchema,
} from "@repo/contract/cloud/account/account-schema";
import type { DeleteAccountResponse } from "@repo/contract/cloud/account/account-schema";
import { eq } from "drizzle-orm";
import { createAuth } from "../auth/auth";
import { refuse, refuseNoDeviceCredential } from "../cloud-http";
import { createDb } from "../db/client";
import type { Db } from "../db/client";
import { session, user } from "../db/schema";
import { spendDeviceBudget } from "../rate-limit";
import { verifyDeviceCredential } from "./device-auth";
import type { VerifiedDevice } from "./device-auth";
import { signInWithPassword } from "./login";

// a live credential with no user row is the deletion race's in-flight sliver; answer what the tombstone would
const refuseDeleted = (): Response => refuse("account-deleted", "This account was deleted.");

const accountRow = async (db: Db, userId: string) =>
  await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).get();

export type AccountDeletion = "deleted" | "invalid-credentials" | "gone";

// the app holds a device credential and no browser session, which is all Better Auth's own
// deleteUser takes: the password mints one here, and deleteUser runs under its cookie, so its
// beforeDelete order and tombstone stay the one purge path. Every door (the REST row today's apps
// call, `/v1/rpc`'s `account.delete`) deletes through this
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

const deleteAccount = async (
  request: Request,
  env: Env,
  exports: Cloudflare.Exports,
  db: Db,
  origin: string,
  verified: VerifiedDevice,
): Promise<Response> => {
  if (!(await spendDeviceBudget(env, db, "accountDelete", verified.deviceId))) {
    return refuse("rate-limited", "Too many attempts — wait a minute.");
  }
  const body = deleteAccountRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return refuse("bad-request", "Send { password }.");
  }
  const deletion = await deleteAccountWithPassword(env, exports, db, {
    origin,
    password: body.data.password,
    userId: verified.userId,
  });
  switch (deletion) {
    case "gone": {
      return refuseDeleted();
    }
    case "invalid-credentials": {
      return refuse("invalid-credentials", "Wrong password.");
    }
    case "deleted": {
      const response: DeleteAccountResponse = { deleted: true };
      return Response.json(response);
    }
    // no default
  }
};

export const handleAccountRoute = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  if (request.method !== "POST" || url.pathname !== ACCOUNT_API_PATHS.delete) {
    return refuse("not-found", "No such route.");
  }
  const db = createDb(env.DB);
  const verified = await verifyDeviceCredential(db, request.headers.get("authorization"));
  if (verified === null) {
    return refuseNoDeviceCredential();
  }
  return await deleteAccount(request, env, ctx.exports, db, url.origin, verified);
};
