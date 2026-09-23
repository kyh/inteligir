import {
  DEVICE_API_PATHS,
  deviceLoginRequestSchema,
  listDevicesResponseSchema,
  revokeDeviceRequestSchema,
} from "@repo/api/cloud/device/device-schema";
import type {
  ListDevicesResponse,
  RevokeDeviceResponse,
} from "@repo/api/cloud/device/device-schema";
import { and, eq, isNull } from "drizzle-orm";
import { verifyDeviceCredential } from "./device-auth";
import { loginDevice } from "./login";
import type { LoginFailure } from "./login";
import { createAuth } from "../auth/auth";
import { jsonNoStore, refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { device } from "../db/schema";
import { allowInWindow, callerRateKey, forgetDeviceBudgets } from "../rate-limit";
import type { RateWindow } from "../rate-limit";
import { severDeviceSockets } from "../sync/routes";

// session auth for everything except login, which IS the authentication, and sign-out, which a
// device asks with its own credential: the local app holds no session

// a login route with no throttle is a password oracle; the window is per address because
// nothing else about the caller is known yet
const LOGIN_WINDOW: RateWindow = { max: 10, windowMs: 60_000 };

const sessionUserId = async (
  request: Request,
  env: Env,
  origin: string,
): Promise<string | null> => {
  const session = await createAuth(env, origin).api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
};

// one message for a wrong password and an unknown address: a caller
// learns only that this pair will not work
const LOGIN_FAILURE_MESSAGE: Record<LoginFailure, string> = {
  "device-limit": "This account has too many active devices — revoke one first.",
  "invalid-credentials": "Wrong email or password.",
};

// false when nothing matched: another account's device, or one already revoked
const revokeDevice = async (
  env: Env,
  db: ReturnType<typeof createDb>,
  target: { deviceId: string; userId: string },
): Promise<boolean> => {
  const revoked = await db
    .update(device)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(device.id, target.deviceId),
        eq(device.userId, target.userId),
        isNull(device.revokedAt),
      ),
    )
    .returning()
    .get();
  if (revoked === undefined) {
    return false;
  }
  // nothing else deletes a limiter row
  await forgetDeviceBudgets(db, [target.deviceId]);
  // the credential is already dead in D1; this closes the sockets it still holds, which no per-request check reaches
  await severDeviceSockets(env, target.userId, target.deviceId);
  return true;
};

export const handleDeviceRoutes = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> => {
  const db = createDb(env.DB);
  const route = `${request.method} ${url.pathname}`;

  if (route === `POST ${DEVICE_API_PATHS.login}`) {
    if (!(await allowInWindow(env, db, callerRateKey("login", request), LOGIN_WINDOW))) {
      return refuse("rate-limited", "Too many attempts — wait a minute.");
    }
    const body = deviceLoginRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return refuse("bad-request", "Send { email, password, deviceName }.");
    }
    const result = await loginDevice(db, env.DB, createAuth(env, url.origin), body.data);
    if (!result.loggedIn) {
      return refuse(result.failure, LOGIN_FAILURE_MESSAGE[result.failure]);
    }
    return jsonNoStore(result.response);
  }

  if (route === `POST ${DEVICE_API_PATHS.signOut}`) {
    const verified = await verifyDeviceCredential(db, request.headers.get("authorization"));
    if (verified === null) {
      return refuse("unauthorized", "No valid device credential.");
    }
    // a dashboard revoke landing after the verify already did the rest: signed out either way
    await revokeDevice(env, db, verified);
    const response: RevokeDeviceResponse = { revoked: true };
    return Response.json(response);
  }

  const userId = await sessionUserId(request, env, url.origin);
  if (userId === null) {
    return refuse("unauthorized", "Sign in first.");
  }

  if (route === `GET ${DEVICE_API_PATHS.list}`) {
    const rows = await db
      .select()
      .from(device)
      .where(eq(device.userId, userId))
      .orderBy(device.createdAt)
      .all();
    const body: ListDevicesResponse = {
      devices: rows.map((row) => ({
        createdAt: row.createdAt.getTime(),
        id: row.id,
        lastSeenAt: row.lastSeenAt?.getTime() ?? null,
        name: row.name,
        revokedAt: row.revokedAt?.getTime() ?? null,
      })),
    };
    return Response.json(listDevicesResponseSchema.parse(body));
  }

  if (route === `POST ${DEVICE_API_PATHS.revoke}`) {
    const body = revokeDeviceRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return refuse("bad-request", "Send { deviceId }.");
    }
    // scoped to the session's own userId, so another account's device answers not-found
    if (!(await revokeDevice(env, db, { deviceId: body.data.deviceId, userId }))) {
      return refuse("not-found", "No such active device.");
    }
    const response: RevokeDeviceResponse = { revoked: true };
    return Response.json(response);
  }

  return refuse("not-found", "No such route.");
};
