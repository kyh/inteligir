// An account's device credentials, as `/v1/rpc`'s `account.devices.*` lists and revokes them
// beside its sessions (`../auth/session-devices.ts`), and a device's own sign-out revokes it.

import type { Device } from "@repo/contract/cloud/device/device-schema";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { device } from "../db/schema";
import { severSockets } from "../library/socket-routes";
import { forgetDeviceBudgets } from "../rate-limit";

export const listDevices = async (
  db: Db,
  userId: string,
  askingDeviceId: string | null,
): Promise<Device[]> => {
  const rows = await db
    .select()
    .from(device)
    .where(eq(device.userId, userId))
    // two sign-ins within one millisecond share a created_at; rowid is their arrival order
    .orderBy(device.createdAt, sql`rowid`)
    .all();
  return rows.map((row) => ({
    createdAt: row.createdAt.getTime(),
    current: row.id === askingDeviceId,
    id: row.id,
    lastSeenAt: row.lastSeenAt?.getTime() ?? null,
    name: row.name,
    revokedAt: row.revokedAt?.getTime() ?? null,
  }));
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
  // the sever first: a fault past the update has no retry, which finds the row already revoked
  await severSockets(ctx.exports, target.userId, { id: target.deviceId, kind: "device" });
  await forgetDeviceBudgets(db, [target.deviceId]);
  return true;
};
