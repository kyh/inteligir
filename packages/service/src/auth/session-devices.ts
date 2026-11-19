import { session } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import type { InternalAdapter } from "better-auth";
import { and, asc, eq, gt } from "drizzle-orm";

export const MAX_SESSIONS_PER_ACCOUNT = 20;

export const capSessions = async (adapter: InternalAdapter, userId: string) => {
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

const firstNamed = (userAgent: string, table: readonly (readonly [string, string])[]) =>
  table.find(([token]) => userAgent.includes(token))?.[1] ?? null;

export const deviceNameOf = (userAgent: string | null) => {
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

export const listSessionDevices = async (userId: string, currentSessionId: string) => {
  const rows = await db
    .select({
      createdAt: session.createdAt,
      id: session.id,
      updatedAt: session.updatedAt,
      userAgent: session.userAgent,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    .orderBy(asc(session.createdAt), asc(session.id));

  return rows.map((row) => ({
    createdAt: row.createdAt.getTime(),
    current: row.id === currentSessionId,
    id: row.id,
    lastSeenAt: row.updatedAt.getTime(),
    name: deviceNameOf(row.userAgent),
  }));
};

export const revokeSessionDevice = async (
  adapter: InternalAdapter,
  target: { readonly id: string; readonly userId: string },
) => {
  const [row] = await db
    .select({ token: session.token })
    .from(session)
    .where(and(eq(session.id, target.id), eq(session.userId, target.userId)));

  if (row === undefined) {
    return false;
  }

  await adapter.deleteSession(row.token);

  return true;
};
