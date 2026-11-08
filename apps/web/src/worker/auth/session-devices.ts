// An account's signed-in devices are Better Auth's own session rows: `account.devices.*` lists
// them, each named from the user agent it signed in with, and ends one by its id; a sign-in past
// the cap ends the longest unused. A session's token never leaves this module: a list selects
// none, and an end looks it up only to hand Better Auth.

import type { Device } from "@repo/contract/cloud/device/device-schema";
import type { InternalAdapter } from "better-auth";
import { and, eq, gt } from "drizzle-orm";

import type { Db } from "../db/client";
import { session } from "../db/schema";

// a sign-in past this many ends one rather than being refused, which would lock out a person who
// lost track of an old device
/** @internal */
export const MAX_SESSIONS_PER_ACCOUNT = 20;

// `databaseHooks.session.create.before`: Better Auth ends each one through its adapter, so its
// `session.delete.after` closes that session's sockets as any sign-out does. Oldest by last use,
// which slides daily, so a device in use outlives one left in a drawer.
export const capSessions = async (adapter: InternalAdapter, userId: string): Promise<void> => {
  const live = await adapter.listSessions(userId, { onlyActiveSessions: true });
  const over = live.length - (MAX_SESSIONS_PER_ACCOUNT - 1);
  if (over <= 0) {
    return;
  }
  const oldest = live
    .toSorted((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .slice(0, over);
  await adapter.deleteSessions(oldest.map((row) => row.token));
};

const BROWSERS = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["Firefox/", "Firefox"],
  ["FxiOS/", "Firefox"],
  ["CriOS/", "Chrome"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
] as const;

const SYSTEMS = [
  ["iPhone", "iPhone"],
  ["iPad", "iPad"],
  ["Android", "Android"],
  ["CrOS", "ChromeOS"],
  ["Macintosh", "Mac"],
  ["Windows", "Windows"],
  ["Linux", "Linux"],
] as const;

const firstNamed = (
  userAgent: string,
  table: readonly (readonly [string, string])[],
): string | null => table.find(([token]) => userAgent.includes(token))?.[1] ?? null;

// read at list time from what Better Auth stored, so a name follows the reading and no column
// holds it. The phone's own requests carry the system's networking stack (CFNetwork) and no
// browser's; the Mac app's window is the system's web view, which names no browser
/** @internal */
export const deviceNameOf = (userAgent: string | null): string => {
  if (userAgent === null || userAgent.trim() === "") {
    return "Unknown device";
  }
  if (!userAgent.startsWith("Mozilla/") && userAgent.includes("CFNetwork/")) {
    return "iPhone";
  }
  const browser = firstNamed(userAgent, BROWSERS);
  const system = firstNamed(userAgent, SYSTEMS);
  if (browser === null) {
    return system === "Mac" && userAgent.includes("AppleWebKit/")
      ? "Mac app"
      : (system ?? "Unknown device");
  }
  return system === null ? browser : `${browser} on ${system}`;
};

export const listSessionDevices = async (
  db: Db,
  userId: string,
  currentSessionId: string | null,
): Promise<Device[]> => {
  const rows = await db
    .select({
      createdAt: session.createdAt,
      id: session.id,
      updatedAt: session.updatedAt,
      userAgent: session.userAgent,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    .orderBy(session.createdAt, session.id)
    .all();
  return rows.map((row) => ({
    createdAt: row.createdAt.getTime(),
    current: row.id === currentSessionId,
    id: row.id,
    lastSeenAt: row.updatedAt.getTime(),
    name: deviceNameOf(row.userAgent),
    revokedAt: null,
  }));
};

// false when the account holds no such session: another account's, or one already ended
export const revokeSessionDevice = async (
  adapter: InternalAdapter,
  db: Db,
  target: { readonly id: string; readonly userId: string },
): Promise<boolean> => {
  const row = await db
    .select({ token: session.token })
    .from(session)
    .where(and(eq(session.id, target.id), eq(session.userId, target.userId)))
    .get();
  if (row === undefined) {
    return false;
  }
  await adapter.deleteSession(row.token);
  return true;
};
