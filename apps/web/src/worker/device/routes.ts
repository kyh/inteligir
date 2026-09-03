import {
  DEVICE_API_PATHS,
  deviceLoginRequestSchema,
  listDevicesResponseSchema,
  revokeDeviceRequestSchema,
  type ListDevicesResponse,
  type RevokeDeviceResponse,
} from "@repo/api/cloud/device/device-schema";
import { and, eq, isNull } from "drizzle-orm";
import { loginDevice, type LoginFailure } from "./login";
import { createAuth } from "../auth/auth";
import { jsonNoStore, refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { device } from "../db/schema";
import { allowInWindow, callerRateKey, forgetDeviceBudgets, type RateWindow } from "../rate-limit";
import { severDeviceSockets } from "../sync/routes";

// session auth for everything except login, which IS the authentication: the local app holds no session

// a login route with no throttle is a password oracle; the window is per address because
// nothing else about the caller is known yet
const LOGIN_WINDOW: RateWindow = { max: 10, windowMs: 60_000 };

async function sessionUserId(request: Request, env: Env, origin: string): Promise<string | null> {
  const session = await createAuth(env, origin).api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}

export async function handleDeviceRoutes(request: Request, env: Env, url: URL): Promise<Response> {
  const db = createDb(env.DB);
  const route = `${request.method} ${url.pathname}`;

  if (route === `POST ${DEVICE_API_PATHS.login}`) {
    if (!(await allowInWindow(env, db, callerRateKey("login", request), LOGIN_WINDOW))) {
      return refuse("rate-limited", "Too many attempts — wait a minute.");
    }
    const body = deviceLoginRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Send { email, password, deviceName }.");
    const result = await loginDevice(db, env.DB, createAuth(env, url.origin), body.data);
    if (!result.loggedIn) {
      return refuse(result.failure, loginFailureMessage(result.failure));
    }
    return jsonNoStore(result.response);
  }

  const userId = await sessionUserId(request, env, url.origin);
  if (userId === null) return refuse("unauthorized", "Sign in first.");

  if (route === `GET ${DEVICE_API_PATHS.list}`) {
    const rows = await db
      .select()
      .from(device)
      .where(eq(device.userId, userId))
      .orderBy(device.createdAt)
      .all();
    const body: ListDevicesResponse = {
      devices: rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.getTime(),
        lastSeenAt: row.lastSeenAt?.getTime() ?? null,
        revokedAt: row.revokedAt?.getTime() ?? null,
      })),
    };
    return Response.json(listDevicesResponseSchema.parse(body));
  }

  if (route === `POST ${DEVICE_API_PATHS.revoke}`) {
    const body = revokeDeviceRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Send { deviceId }.");
    // scoped to the session's own userId; an already-revoked device matches nothing and answers not-found
    const revoked = await db
      .update(device)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(device.id, body.data.deviceId), eq(device.userId, userId), isNull(device.revokedAt)),
      )
      .returning()
      .get();
    if (revoked === undefined) return refuse("not-found", "No such active device.");
    // nothing else deletes a limiter row
    await forgetDeviceBudgets(db, [body.data.deviceId]);
    // the credential is already dead in D1; this closes the sockets it still holds, which no per-request check reaches
    await severDeviceSockets(env, userId, body.data.deviceId);
    const response: RevokeDeviceResponse = { revoked: true };
    return Response.json(response);
  }

  return refuse("not-found", "No such route.");
}

// one message for a wrong password and an unknown address: a caller
// learns only that this pair will not work
function loginFailureMessage(failure: LoginFailure): string {
  switch (failure) {
    case "invalid-credentials":
      return "Wrong email or password.";
    case "device-limit":
      return "This account has too many active devices — revoke one first.";
  }
}
