import { deviceSignUpRequestSchema } from "@repo/contract/cloud/account/account-schema";
import {
  DEVICE_API_PATHS,
  deviceLoginRequestSchema,
  listDevicesResponseSchema,
  revokeDeviceRequestSchema,
} from "@repo/contract/cloud/device/device-schema";
import type { RevokeDeviceResponse } from "@repo/contract/cloud/device/device-schema";
import { carriesDeviceCredential, verifyDeviceCredential } from "./device-auth";
import { listDevices, revokeDevice } from "./devices";
import { loginDevice } from "./login";
import type { LoginFailure } from "./login";
import { signUpDevice } from "./sign-up";
import { createAuth, createSignUpAuth } from "../auth/auth";
import { signUpBodyRefusal } from "../auth/invite";
import { jsonNoStore, refuse, refuseNoDeviceCredential } from "../cloud-http";
import { createDb } from "../db/client";
import type { Db } from "../db/client";
import { spendCallerBudget } from "../rate-limit";

// login and sign-up ARE the authentication; sign-out is a device's alone, since a session naming
// no device has nothing to sign out

// list and revoke answer a signed-in browser, or any live device of the account, since the local
// app and the phone hold no session. A device credential is judged by the device table alone: a
// revoked one is refused, never handed on to Better Auth
const accountUserId = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  db: Db,
  origin: string,
): Promise<string | null> => {
  const authorization = request.headers.get("authorization");
  if (carriesDeviceCredential(authorization)) {
    const verified = await verifyDeviceCredential(db, authorization);
    return verified?.userId ?? null;
  }
  const session = await createAuth(env, ctx.exports, origin).api.getSession({
    headers: request.headers,
  });
  return session?.user.id ?? null;
};

// one message for a wrong password and an unknown address: a caller
// learns only that this pair will not work
const LOGIN_FAILURE_MESSAGE: Record<LoginFailure, string> = {
  "device-limit": "This account has too many active devices — revoke one first.",
  "invalid-credentials": "Wrong email or password.",
};

export const handleDeviceRoutes = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  const db = createDb(env.DB);
  const route = `${request.method} ${url.pathname}`;

  if (route === `POST ${DEVICE_API_PATHS.login}`) {
    if (!(await spendCallerBudget(env, db, "login", request))) {
      return refuse("rate-limited", "Too many attempts — wait a minute.");
    }
    const body = deviceLoginRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return refuse("bad-request", "Send { email, password, deviceName }.");
    }
    const result = await loginDevice(db, createAuth(env, ctx.exports, url.origin), body.data);
    if (!result.loggedIn) {
      return refuse(result.failure, LOGIN_FAILURE_MESSAGE[result.failure]);
    }
    return jsonNoStore(result.response);
  }

  if (route === `POST ${DEVICE_API_PATHS.signUp}`) {
    // the site's invite gate spends this window too, so two doors are not twice the guesses
    if (!(await spendCallerBudget(env, db, "inviteSignUp", request))) {
      return refuse("rate-limited", "Too many attempts — wait a minute.");
    }
    const body = deviceSignUpRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return refuse(
        "bad-request",
        signUpBodyRefusal(body.error, "Send { name, email, password, inviteCode, deviceName }."),
      );
    }
    const result = await signUpDevice(
      db,
      createSignUpAuth(env, ctx.exports, url.origin),
      body.data,
    );
    if (!result.signedUp) {
      return refuse(result.failure, result.message);
    }
    return jsonNoStore(result.response);
  }

  if (route === `POST ${DEVICE_API_PATHS.signOut}`) {
    const verified = await verifyDeviceCredential(db, request.headers.get("authorization"));
    if (verified === null) {
      return refuseNoDeviceCredential();
    }
    // a dashboard revoke landing after the verify already did the rest: signed out either way
    await revokeDevice(ctx, db, verified);
    const response: RevokeDeviceResponse = { revoked: true };
    return Response.json(response);
  }

  const userId = await accountUserId(request, env, ctx, db, url.origin);
  if (userId === null) {
    return carriesDeviceCredential(request.headers.get("authorization"))
      ? refuseNoDeviceCredential()
      : refuse("unauthorized", "Sign in first.");
  }

  if (route === `GET ${DEVICE_API_PATHS.list}`) {
    return Response.json(listDevicesResponseSchema.parse(await listDevices(db, userId)));
  }

  if (route === `POST ${DEVICE_API_PATHS.revoke}`) {
    const body = revokeDeviceRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return refuse("bad-request", "Send { deviceId }.");
    }
    // scoped to the caller's own userId, so another account's device answers not-found
    if (!(await revokeDevice(ctx, db, { deviceId: body.data.deviceId, userId }))) {
      return refuse("not-found", "No such active device.");
    }
    const response: RevokeDeviceResponse = { revoked: true };
    return Response.json(response);
  }

  return refuse("not-found", "No such route.");
};
