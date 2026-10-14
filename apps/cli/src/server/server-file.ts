// the bearer proves the caller can read this data directory, not that either
// end is this code — a same-user process can read the file. removed on ordered
// shutdown; a crash leaves it behind on purpose, so the dial fails rather than
// looking like "never started".

import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { errnoCode } from "./errno";
import { LOOPBACK_HOST } from "./loopback-origin";
import { stagedWriteFileSync } from "./staged-write";

export const SERVER_FILE_NAME = "server.json";

export const loopbackOrigin = (port: number): string => `http://${LOOPBACK_HOST}:${String(port)}`;

const SERVER_FILE_MODE = 0o600;

const TOKEN_BYTES = 32;

export const BEARER_PREFIX = "Bearer ";

// lenient about extra keys: a newer build's file must not brick an older reader.
const serverFileSchema = z.object({
  // lets the second-boot guard ask the OS whether the owner still exists before dialing.
  pid: z.number().int().min(1),
  // the bound port, which may be a probed one; never the configured value.
  port: z.number().int().min(1).max(65_535),
  token: z.string().min(1),
  // diagnostic only; nothing branches on it.
  vaultDir: z.string().min(1),
  // /local may break between releases, so a CLI installed apart from the app refuses a server of
  // another one.
  version: z.string().min(1),
});

export type ServerFile = z.infer<typeof serverFileSchema>;

const serverFilePath = (dataDir: string): string => path.join(dataDir, SERVER_FILE_NAME);

// per boot, not per install: a token that outlives its process can be replayed against the next one.
export const mintServerToken = (): string => randomBytes(TOKEN_BYTES).toString("base64url");

export const writeServerFile = (dataDir: string, value: ServerFile): void => {
  mkdirSync(dataDir, { recursive: true });
  stagedWriteFileSync(serverFilePath(dataDir), `${JSON.stringify(value, null, 2)}\n`, {
    mode: SERVER_FILE_MODE,
  });
  chmodSync(serverFilePath(dataDir), SERVER_FILE_MODE);
};

export const readServerFile = (dataDir: string): ServerFile | null => {
  let raw: string;
  try {
    raw = readFileSync(serverFilePath(dataDir), "utf-8");
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT" || code === "EACCES") {
      return null;
    }
    throw error;
  }
  try {
    return serverFileSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

// only this boot's own row: a row minted by another boot is that server's address, not ours to retract.
export const removeServerFile = (dataDir: string, token: string): void => {
  if (readServerFile(dataDir)?.token !== token) {
    return;
  }
  rmSync(serverFilePath(dataDir), { force: true });
};

export const authorizationHeader = (token: string): string => `${BEARER_PREFIX}${token}`;
