import {
  ACCOUNT_API_PATHS,
  deleteAccountRequestSchema,
} from "@repo/api/cloud/account/account-schema";
import type {
  AccountResponse,
  DeleteAccountResponse,
} from "@repo/api/cloud/account/account-schema";
import { eq } from "drizzle-orm";
import { createAuth } from "../auth/auth";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { session, user } from "../db/schema";
import { spendDeviceBudget } from "../rate-limit";
import { verifyDeviceCredential } from "./device-auth";
import type { VerifiedDevice } from "./device-auth";
import { signInWithPassword } from "./login";

type Db = ReturnType<typeof createDb>;

// a live credential with no user row is the deletion race's in-flight sliver; answer what the tombstone would
const refuseDeleted = (): Response => refuse("account-deleted", "This account was deleted.");

const accountRow = async (db: Db, userId: string) =>
  await db.select({ email: user.email, id: user.id }).from(user).where(eq(user.id, userId)).get();

const readAccount = async (db: Db, verified: VerifiedDevice): Promise<Response> => {
  const row = await accountRow(db, verified.userId);
  if (row === undefined) {
    return refuseDeleted();
  }
  const response: AccountResponse = { email: row.email, id: row.id };
  return Response.json(response);
};

// the app holds a device credential and no browser session, which is all Better Auth's own
// delete-user takes: the password mints one here, and deleteUser runs under it, so its
// beforeDelete order and tombstone stay the one purge path
const deleteAccount = async (
  request: Request,
  env: Env,
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
  const row = await accountRow(db, verified.userId);
  if (row === undefined) {
    return refuseDeleted();
  }
  const auth = createAuth(env, origin);
  const signedIn = await signInWithPassword(auth, row.email, body.data.password);
  if (signedIn === null) {
    return refuse("invalid-credentials", "Wrong password.");
  }
  try {
    // no password in the body: the sign-in just checked it, and the session it minted is fresh
    await auth.api.deleteUser({
      body: {},
      headers: new Headers({ authorization: `Bearer ${signedIn.token}` }),
    });
  } finally {
    // a deletion that aborted leaves the sign-in's session behind, a bearer nobody holds
    await db.delete(session).where(eq(session.token, signedIn.token));
  }
  const response: DeleteAccountResponse = { deleted: true };
  return Response.json(response);
};

export const handleAccountRoute = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> => {
  const route = `${request.method} ${url.pathname}`;
  const reading = route === `GET ${ACCOUNT_API_PATHS.account}`;
  if (!reading && route !== `POST ${ACCOUNT_API_PATHS.delete}`) {
    return refuse("not-found", "No such route.");
  }
  const db = createDb(env.DB);
  const verified = await verifyDeviceCredential(db, request.headers.get("authorization"));
  if (verified === null) {
    return refuse("unauthorized", "No valid device credential.");
  }
  return reading
    ? await readAccount(db, verified)
    : await deleteAccount(request, env, db, url.origin, verified);
};
