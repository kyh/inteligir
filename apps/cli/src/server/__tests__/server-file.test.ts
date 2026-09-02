import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizationHeader,
  mintServerToken,
  presentedCredential,
  readServerFile,
  removeServerFile,
  SERVER_FILE_NAME,
  SERVER_TOKEN_COOKIE,
  serverTokenCookie,
  tokenAccepted,
  writeServerFile,
} from "../server-file";
import { makeTempDir } from "./temp-dir";

const ROW = { port: 4664, token: "tok", vaultDir: "/vault", pid: 42 };

describe("the server file", () => {
  it("round-trips the row a caller needs to reach this instance", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    writeServerFile(dataDir, ROW);
    expect(readServerFile(dataDir)).toEqual(ROW);
  });

  it("is owner-only, and stays so when it is rewritten", () => {
    // writeFileSync's mode applies only on create, so the chmod simulates a file inherited from a laxer umask.
    const dataDir = makeTempDir("inteligir-server-file-");
    writeServerFile(dataDir, ROW);
    chmodSync(join(dataDir, SERVER_FILE_NAME), 0o644);
    writeServerFile(dataDir, { ...ROW, port: 4665 });
    expect(statSync(join(dataDir, SERVER_FILE_NAME)).mode & 0o777).toBe(0o600);
  });

  it("answers null for a data dir with no server, and for a row it cannot parse", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    expect(readServerFile(dataDir)).toBeNull();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, SERVER_FILE_NAME), "{ not json", "utf8");
    expect(readServerFile(dataDir)).toBeNull();
    writeFileSync(join(dataDir, SERVER_FILE_NAME), JSON.stringify({ port: 4664 }), "utf8");
    expect(readServerFile(dataDir)).toBeNull();
  });

  it("removes the row, so a stale one never sends the next caller at a dead port", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    writeServerFile(dataDir, ROW);
    removeServerFile(dataDir);
    expect(readServerFile(dataDir)).toBeNull();
    expect(() => removeServerFile(dataDir)).not.toThrow();
  });

  it("mints a fresh token per boot — a persisted one is replayable", () => {
    expect(mintServerToken()).not.toBe(mintServerToken());
    expect(mintServerToken().length).toBeGreaterThan(32);
  });

  it("never writes the token into a file anything but the owner can read", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    const token = mintServerToken();
    writeServerFile(dataDir, { ...ROW, token });
    expect(readFileSync(join(dataDir, SERVER_FILE_NAME), "utf8")).toContain(token);
  });
});

describe("what a request presents", () => {
  it("reads the bearer, and prefers it over a cookie", () => {
    expect(
      presentedCredential({ authorization: authorizationHeader("header-tok"), cookie: undefined }),
    ).toEqual({ token: "header-tok", carrier: "header" });
    expect(
      presentedCredential({
        authorization: authorizationHeader("header-tok"),
        cookie: `${SERVER_TOKEN_COOKIE}=cookie-tok`,
      }),
    ).toEqual({ token: "header-tok", carrier: "header" });
  });

  it("reads the cookie out of a header carrying several", () => {
    expect(
      presentedCredential({
        authorization: undefined,
        cookie: `theme=dark; ${SERVER_TOKEN_COOKIE}=cookie-tok; other=1`,
      }),
    ).toEqual({ token: "cookie-tok", carrier: "cookie" });
  });

  it("is null for anything that is not a credential", () => {
    for (const authorization of [undefined, "Bearer ", "Basic abc", "bearer lowercase"]) {
      expect(presentedCredential({ authorization, cookie: undefined })).toBeNull();
    }
    expect(presentedCredential({ authorization: undefined, cookie: "unrelated=1" })).toBeNull();
    expect(presentedCredential({ authorization: undefined, cookie: "novalue" })).toBeNull();
  });

  it("accepts only the exact token", () => {
    expect(tokenAccepted("abc", "abc")).toBe(true);
    expect(tokenAccepted("abc", "abd")).toBe(false);
    expect(tokenAccepted("abc", "ab")).toBe(false);
    expect(tokenAccepted("abc", null)).toBe(false);
  });
});

describe("the browser's carrier", () => {
  it("is HttpOnly and SameSite=Strict — script cannot read it, a hostile page cannot send it", () => {
    const cookie = serverTokenCookie("tok");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    // never `Secure`: some browsers drop a Secure cookie on plain-http loopback rather than ignoring the attribute.
    expect(cookie).not.toContain("Secure");
  });
});
