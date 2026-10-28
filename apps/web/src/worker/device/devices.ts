// An account's devices, as every door lists and revokes them: the REST rows today's apps call and
// `/v1/rpc`'s `account.devices.*`.

import type { ListDevicesResponse } from "@repo/contract/cloud/device/device-schema";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { device } from "../db/schema";
import { libraryCell } from "../library/library-cell";
import { errorFields } from "../log";
import { forgetDeviceBudgets } from "../rate-limit";

export const listDevices = async (db: Db, userId: string): Promise<ListDevicesResponse> => {
  const rows = await db
    .select()
    .from(device)
    .where(eq(device.userId, userId))
    // two sign-ins within one millisecond share a created_at; rowid is their arrival order
    .orderBy(device.createdAt, sql`rowid`)
    .all();
  return {
    devices: rows.map((row) => ({
      createdAt: row.createdAt.getTime(),
      id: row.id,
      lastSeenAt: row.lastSeenAt?.getTime() ?? null,
      name: row.name,
      revokedAt: row.revokedAt?.getTime() ?? null,
    })),
  };
};

// false when nothing matched: another account's device, or one already revoked
export const revokeDevice = async (
  ctx: ExecutionContext,
  db: Db,
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
  await forgetDeviceBudgets(db, [target.deviceId]);
  // the credential is already dead in D1; this closes the sockets it still holds, which no
  // per-request check reaches. Best-effort: a failure costs a stale socket, never a live credential
  try {
    await libraryCell(ctx.exports, target.userId).severDevice(target.deviceId);
  } catch (error) {
    console.warn({ event: "socket-sever-failed", ...errorFields(error) });
  }
  return true;
};
