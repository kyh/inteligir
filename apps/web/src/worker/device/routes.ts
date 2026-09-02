import {
  DEVICE_API_PATHS,
  listDevicesResponseSchema,
  mintPairingCodeRequestSchema,
  redeemDeviceRequestSchema,
  revokeDeviceRequestSchema,
  type ListDevicesResponse,
  type RevokeDeviceResponse,
} from "@repo/api/cloud/pairing/pairing-schema";
import { and, eq, isNull } from "drizzle-orm";
import { mintPairingCode, redeemPairingCode } from "./pairing";
import { createAuth } from "../auth/auth";
import { jsonNoStore, refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { device } from "../db/schema";
import { allowInWindow, callerIp, forgetDeviceBudgets, type RateWindow } from "../rate-limit";
import { severDeviceSockets } from "../sync/routes";

// session auth for everything except redeem, where the code is the credential: the local app holds no session

// a code is 2^40 with a 10-minute life; the window makes guessing loud rather than carrying the entropy
const REDEEM_WINDOW: RateWindow = { max: 10, windowMs: 60_000 };
const REDEEM_RATE_KEY_PREFIX = "device-redeem:";

async function sessionUserId(request: Request, env: Env, origin: string): Promise<string | null> {
  const session = await createAuth(env, origin).api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}

export async function handleDeviceRoutes(request: Request, env: Env, url: URL): Promise<Response> {
  const db = createDb(env.DB);
  const route = `${request.method} ${url.pathname}`;

  if (route === `POST ${DEVICE_API_PATHS.redeem}`) {
    const key = `${REDEEM_RATE_KEY_PREFIX}${callerIp(request)}`;
    if (!(await allowInWindow(env, db, key, REDEEM_WINDOW))) {
      return refuse("rate-limited", "Too many attempts — wait a minute.");
    }
    const body = redeemDeviceRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Send { code, deviceName, verifier }.");
    const redeemed = await redeemPairingCode(
      db,
      env.DB,
      body.data.code,
      body.data.deviceName,
      body.data.verifier,
    );
    if (!redeemed.redeemed) {
      return refuse(redeemed.failure, redeemFailureMessage(redeemed.failure));
    }
    return jsonNoStore(redeemed.response);
  }

  const userId = await sessionUserId(request, env, url.origin);
  if (userId === null) return refuse("unauthorized", "Sign in first.");

  if (route === `POST ${DEVICE_API_PATHS.mintCode}`) {
    const body = mintPairingCodeRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse("bad-request", "Send { challenge, challengeMethod: 'S256' }.");
    return jsonNoStore(await mintPairingCode(db, userId, body.data.challenge));
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

function redeemFailureMessage(
  failure: "invalid-code" | "code-expired" | "code-consumed" | "device-limit",
): string {
  switch (failure) {
    case "invalid-code":
      return "That pairing code isn't valid.";
    case "code-expired":
      return "That pairing code expired — start pairing again from the app.";
    case "code-consumed":
      return "That pairing code was already used — start pairing again from the app.";
    case "device-limit":
      return "This account has too many active devices — revoke one first.";
  }
}
