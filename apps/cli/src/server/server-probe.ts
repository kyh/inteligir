// one reading of whether server.json's owner still serves, for every caller that must decide:
// the boot's guard and lock, and the desktop shell's adoption. two readings would disagree about
// a busy server, and the shell would spawn a child over it that the child's own guard refuses.

import { z } from "zod";
import { errnoCode } from "./errno";
import { createLocalClient } from "./local-client";
import { loopbackOrigin, readServerFile } from "./server-file";
import type { ServerFile } from "./server-file";

// EPERM is a live process this user may not signal; ESRCH is gone.
export const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) === "EPERM";
  }
};

// its own deadline, not the client's: the catch must tell "refused" from "never answered".
const SILENT_AFTER_MS = 1500;

// the fields a caller judges by, not the whole status: that schema is strict, so a server one
// field newer would read as unreadable rather than as another version.
const serverIdentitySchema = z.object({
  dataDir: z.string().min(1),
  version: z.string().min(1),
});

export type ServerIdentity = z.infer<typeof serverIdentitySchema>;

export type StatusAnswer =
  | { kind: "answered"; body: unknown }
  | { kind: "silent" }
  // the connection, the token or the call itself
  | { kind: "refused" };

export type AskServerStatus = (row: ServerFile) => Promise<StatusAnswer>;

const askStatusOverRpc: AskServerStatus = async (row) => {
  const client = createLocalClient({
    origin: loopbackOrigin(row.port),
    // well past the deadline below, so the client's own abort never fires first.
    timeoutMs: SILENT_AFTER_MS * 4,
    token: row.token,
  });
  const deadline = AbortSignal.timeout(SILENT_AFTER_MS);
  try {
    const body: unknown = await client.system.status(undefined, { signal: deadline });
    return { body, kind: "answered" };
  } catch {
    return deadline.aborted ? { kind: "silent" } : { kind: "refused" };
  }
};

export type ServerFileProbe =
  | { kind: "none" }
  | { kind: "dead-owner"; row: ServerFile }
  // connected and never answered: better-sqlite3 is synchronous, so a large batch blocks the loop
  // of a server still holding the vault.
  | { kind: "silent"; row: ServerFile; origin: string }
  | { kind: "refused"; row: ServerFile; origin: string }
  // a 200 that names no server proves nothing, not even that the token was read.
  | { kind: "unreadable"; row: ServerFile; origin: string }
  | { kind: "answered"; row: ServerFile; origin: string; identity: ServerIdentity };

export const probeServerFile = async (
  dataDir: string,
  askStatus: AskServerStatus = askStatusOverRpc,
): Promise<ServerFileProbe> => {
  const row = readServerFile(dataDir);
  if (row === null) {
    return { kind: "none" };
  }
  if (!processAlive(row.pid)) {
    return { kind: "dead-owner", row };
  }
  const origin = loopbackOrigin(row.port);
  const answer = await askStatus(row);
  if (answer.kind !== "answered") {
    return { kind: answer.kind, origin, row };
  }
  const identity = serverIdentitySchema.safeParse(answer.body);
  return identity.success
    ? { identity: identity.data, kind: "answered", origin, row }
    : { kind: "unreadable", origin, row };
};

export const silentOwnerSentence = (
  dataDir: string,
  owner: Pick<ServerFile, "pid" | "port">,
): string =>
  `An inteligir server (pid ${String(owner.pid)}) still holds ${dataDir} on port ${String(owner.port)} and is not answering.`;
