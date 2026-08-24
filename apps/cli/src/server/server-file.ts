// WHERE IS THE SERVER, AND MAY I TALK TO IT? Both answers, in one file.
//
// A loopback port identifies nothing — it is first-come-first-served and
// unauthenticated — so "something answered /health on 4664" is not an answer
// to either question. `<dataDir>/server.json` is: the server writes it at
// 0600 once it has bound, and every caller that can read that directory
// learns the port to dial AND the bearer to present.
//
// THE BOUND IS THE SAME ONE THE CHALLENGE-RESPONSE IT REPLACES HAD, stated
// plainly: this proves the caller can READ THIS DATA DIRECTORY. It is not
// proof that either end is this code — a process running as the same user can
// read the file, and no file mode can prevent that. That is exactly the line
// worth drawing here, because it separates "the program that owns this vault"
// from "the program that got to the port first".
//
// IT ANSWERS BOTH DIRECTIONS. A squatter on the port cannot produce the token,
// so a client fails closed instead of writing into a stranger's vault; and a
// hostile page cannot read the data dir, so it cannot drive the API either.
//
// AND WHAT IT COSTS, stated: a token is SENT, so anything that can read the
// wire or a request log can capture it, and it does not expire per call. On
// loopback, with the file at 0600, a reader who could do either could read the
// file anyway.
//
// The file is REMOVED on ordered shutdown, so a stale row never sends the next
// caller at a port nothing holds. A crash leaves it behind on purpose: the
// caller's dial fails, which is a better failure than no file at all (which is
// indistinguishable from "never started").

import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { constantTimeEqual } from "./constant-time-equal";
import { errnoCode } from "./errno";
import { stagedWriteFileSync } from "./staged-write";

export const SERVER_FILE_NAME = "server.json";

/** Owner read/write. Applied on every write, not only on create — see
 *  `stagedWriteFileSync`, which stages inside this directory and chmods
 *  before the rename so the token is never group-readable, even briefly. */
const SERVER_FILE_MODE = 0o600;

/** 256 bits, base64url. Large enough that the file is the only way to it. */
const TOKEN_BYTES = 32;

/**
 * The bearer scheme's own spelling, in one place: the header a caller sends
 * and the prefix the server strips are the same string.
 */
const BEARER_PREFIX = "Bearer ";

/**
 * The cookie the SERVED DOCUMENT carries the same token in.
 *
 * A browser cannot attach an `Authorization` header to a document navigation,
 * to a `<img src>`, or to a `new WebSocket(...)` — so the one client that is a
 * browser needs the credential in the one carrier a browser attaches by
 * itself. `HttpOnly` keeps it out of the DOM (script never reads it, which is
 * the property an in-page token would give up), and `SameSite=Strict` is what
 * makes it safe on a loopback origin any page can address: a cross-site
 * request simply does not carry it, so a hostile page reaches the API with no
 * credential at all — which is the same place the bearer leaves it.
 *
 * Not `Secure`: this origin is plain http, and a `Secure` cookie on it would
 * be dropped by some browsers rather than merely ignored.
 */
export const SERVER_TOKEN_COOKIE = "inteligir_session";

export function serverTokenCookie(token: string): string {
  return `${SERVER_TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

/**
 * What the file says. Lenient about extra keys on read for the reason the
 * managed config is: a newer build's file must not brick an older reader.
 */
const serverFileSchema = z.object({
  /** The port actually BOUND, which may be a probed one — never the configured
   *  value. A caller dials this and nothing else; there is no probe range. */
  port: z.number().int().min(1).max(65_535),
  token: z.string().min(1),
  /** What this instance is serving. A caller that derived which instance it
   *  means compares this before trusting the row, so a data dir shared by
   *  accident is caught rather than silently written to. */
  vaultDir: z.string().min(1),
  /** Whose file this is. Diagnostic only — nothing branches on it — but it is
   *  what makes a stale file after a crash identifiable by a human. */
  pid: z.number().int().min(1),
});

export type ServerFile = z.infer<typeof serverFileSchema>;

function serverFilePath(dataDir: string): string {
  return join(dataDir, SERVER_FILE_NAME);
}

/** A fresh bearer, per BOOT rather than per install: a token that outlives its
 *  process is a credential someone can replay against the next one, and there
 *  is nothing to gain by persisting it — every reader takes it from the file,
 *  which is rewritten before any caller is told the port. */
export function mintServerToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function writeServerFile(dataDir: string, value: ServerFile): void {
  mkdirSync(dataDir, { recursive: true });
  stagedWriteFileSync(serverFilePath(dataDir), `${JSON.stringify(value, null, 2)}\n`, {
    mode: SERVER_FILE_MODE,
  });
  chmodSync(serverFilePath(dataDir), SERVER_FILE_MODE);
}

/** The row this data dir currently holds, or null when there is none to read —
 *  no server is running against it, this process may not read it, or what is
 *  there is not a row this build understands. */
export function readServerFile(dataDir: string): ServerFile | null {
  let raw: string;
  try {
    raw = readFileSync(serverFilePath(dataDir), "utf8");
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
}

export function removeServerFile(dataDir: string): void {
  rmSync(serverFilePath(dataDir), { force: true });
}

/** The token a request presents, from whichever carrier it used, or null. The
 *  header wins: a programmatic caller that bothered to set one means it. */
export function presentedToken(headers: {
  authorization: string | undefined;
  cookie: string | undefined;
}): string | null {
  const authorization = headers.authorization;
  if (authorization !== undefined && authorization.startsWith(BEARER_PREFIX)) {
    const value = authorization.slice(BEARER_PREFIX.length).trim();
    return value.length === 0 ? null : value;
  }
  return cookieValue(headers.cookie, SERVER_TOKEN_COOKIE);
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined) {
    return null;
  }
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) {
      continue;
    }
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return null;
}

/** Compared the way a secret is — one spelling, so no caller regresses to
 *  `===`. */
export function tokenAccepted(expected: string, presented: string | null): boolean {
  return presented !== null && constantTimeEqual(expected, presented);
}

export function authorizationHeader(token: string): string {
  return `${BEARER_PREFIX}${token}`;
}
