import {
  DEVICE_API_PATHS,
  listDevicesResponseSchema,
  mintPairingCodeRequestSchema,
  redeemDeviceRequestSchema,
  revokeDeviceRequestSchema,
  type ListDevicesResponse,
  type RevokeDeviceResponse,
} from "@repo/cloud-contract/pairing";
import { and, eq, isNull } from "drizzle-orm";
import { mintPairingCode, redeemPairingCode } from "./pairing";
import { createAuth } from "../auth/auth";
import { jsonNoStore, refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { device } from "../db/schema";
import { allowInWindow, callerIp, type RateWindow } from "../rate-limit";
import { severDeviceSockets } from "../sync/routes";

// ---------------------------------------------------------------------------
// `/v1/device/*` — the pairing surface.
//
//   POST /v1/device/code    session  mint a one-time pairing code (/app/pair)
//   POST /v1/device/redeem  code     exchange it for the durable credential
//   GET  /v1/device/list    session  the dashboard's device table
//   POST /v1/device/revoke  session  cut a device off (bites next request)
//
// AUTH is the Better Auth SESSION (cookie or bearer) for everything except
// redeem, where the code IS the credential — the local app holds no session
// and never will; the whole point of pairing is to end with a credential that
// is not the account's.
// ---------------------------------------------------------------------------

/** Redeem attempts per IP. A code is 2^40 with a 10-minute life, so the window
 * exists to make guessing loud, not to carry the entropy. */
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
    if (env.RATE_LIMIT_DISABLED !== "true") {
      const key = `${REDEEM_RATE_KEY_PREFIX}${callerIp(request)}`;
      if (!(await allowInWindow(db, key, Date.now(), REDEEM_WINDOW))) {
        return refuse("rate-limited", "Too many attempts — wait a minute.");
      }
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
    // Scoped to the session's own userId, so no session can revoke across
    // accounts; already-revoked matches nothing and answers not-found, which
    // keeps the route idempotent-safe to retry from the dashboard.
    const revoked = await db
      .update(device)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(device.id, body.data.deviceId), eq(device.userId, userId), isNull(device.revokedAt)),
      )
      .returning()
      .get();
    if (revoked === undefined) return refuse("not-found", "No such active device.");
    // The credential is already dead in D1 — this only closes the sockets it
    // still holds, which no per-request check can reach.
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
