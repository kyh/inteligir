// the bearer proves the caller can read this data directory, not that either
// end is this code — a same-user process can read the file. removed on ordered
// shutdown; a crash leaves it behind on purpose, so the dial fails rather than
// looking like "never started".

import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { constantTimeEqual } from "@repo/api/cloud/bytes";
import { errnoCode } from "./errno";
import { stagedWriteFileSync } from "./staged-write";

export const SERVER_FILE_NAME = "server.json";

const SERVER_FILE_MODE = 0o600;

const TOKEN_BYTES = 32;

const BEARER_PREFIX = "Bearer ";

// a browser cannot attach an Authorization header to a navigation, an <img> or
// a WebSocket, so it gets the token as a cookie. SameSite=Strict does not close
// cross-port ("site" ignores the port); browser-request.ts checks the origin
// of cookie-authed requests. not Secure: some browsers drop a Secure cookie on plain http.
export const SERVER_TOKEN_COOKIE = "inteligir_session";

export const serverTokenCookie = (token: string): string =>
  `${SERVER_TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;

// lenient about extra keys: a newer build's file must not brick an older reader.
const serverFileSchema = z.object({
  // lets the second-boot guard ask the OS whether the owner still exists before dialing.
  pid: z.number().int().min(1),
  // the bound port, which may be a probed one; never the configured value.
  port: z.number().int().min(1).max(65_535),
  token: z.string().min(1),
  // diagnostic only; nothing branches on it.
  vaultDir: z.string().min(1),
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

export const removeServerFile = (dataDir: string): void => {
  rmSync(serverFilePath(dataDir), { force: true });
};

// the bearer proves the caller read the data dir; the cookie is ambient, so only it needs the same-origin check.
export type TokenCarrier = "header" | "cookie";

export interface PresentedCredential {
  token: string;
  carrier: TokenCarrier;
}

const cookieValue = (header: string | undefined, name: string): string | null => {
  if (header === undefined) {
    return null;
  }
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return null;
};

// the header wins: a caller that set one means it.
export const presentedCredential = (headers: {
  authorization: string | undefined;
  cookie: string | undefined;
}): PresentedCredential | null => {
  const { authorization } = headers;
  if (authorization !== undefined && authorization.startsWith(BEARER_PREFIX)) {
    const value = authorization.slice(BEARER_PREFIX.length).trim();
    return value.length === 0 ? null : { carrier: "header", token: value };
  }
  const cookie = cookieValue(headers.cookie, SERVER_TOKEN_COOKIE);
  return cookie === null ? null : { carrier: "cookie", token: cookie };
};

export const tokenAccepted = (expected: string, presented: string | null): boolean =>
  presented !== null && constantTimeEqual(expected, presented);

export const authorizationHeader = (token: string): string => `${BEARER_PREFIX}${token}`;
