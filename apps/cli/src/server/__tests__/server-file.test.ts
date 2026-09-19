import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
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

const ROW = { pid: 42, port: 4664, token: "tok", vaultDir: "/vault" };

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
    chmodSync(path.join(dataDir, SERVER_FILE_NAME), 0o644);
    writeServerFile(dataDir, { ...ROW, port: 4665 });
    // oxlint-disable-next-line no-bitwise -- masking the permission bits out of a stat mode
    expect(statSync(path.join(dataDir, SERVER_FILE_NAME)).mode & 0o777).toBe(0o600);
  });

  it("answers null for a data dir with no server, and for a row it cannot parse", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    expect(readServerFile(dataDir)).toBeNull();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, SERVER_FILE_NAME), "{ not json", "utf-8");
    expect(readServerFile(dataDir)).toBeNull();
    writeFileSync(path.join(dataDir, SERVER_FILE_NAME), JSON.stringify({ port: 4664 }), "utf-8");
    expect(readServerFile(dataDir)).toBeNull();
  });

  it("removes the row, so a stale one never sends the next caller at a dead port", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    writeServerFile(dataDir, ROW);
    removeServerFile(dataDir);
    expect(readServerFile(dataDir)).toBeNull();
    expect(() => {
      removeServerFile(dataDir);
    }).not.toThrow();
  });

  it("mints a fresh token per boot — a persisted one is replayable", () => {
    expect(mintServerToken()).not.toBe(mintServerToken());
    expect(mintServerToken().length).toBeGreaterThan(32);
  });

  it("never writes the token into a file anything but the owner can read", () => {
    const dataDir = makeTempDir("inteligir-server-file-");
    const token = mintServerToken();
    writeServerFile(dataDir, { ...ROW, token });
    expect(readFileSync(path.join(dataDir, SERVER_FILE_NAME), "utf-8")).toContain(token);
  });
});

describe("what a request presents", () => {
  it("reads the bearer, and prefers it over a cookie", () => {
    expect(
      presentedCredential({ authorization: authorizationHeader("header-tok"), cookie: undefined }),
    ).toEqual({ carrier: "header", token: "header-tok" });
    expect(
      presentedCredential({
        authorization: authorizationHeader("header-tok"),
        cookie: `${SERVER_TOKEN_COOKIE}=cookie-tok`,
      }),
    ).toEqual({ carrier: "header", token: "header-tok" });
  });

  it("reads the cookie out of a header carrying several", () => {
    expect(
      presentedCredential({
        authorization: undefined,
        cookie: `theme=dark; ${SERVER_TOKEN_COOKIE}=cookie-tok; other=1`,
      }),
    ).toEqual({ carrier: "cookie", token: "cookie-tok" });
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
