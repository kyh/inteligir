// Store-level tests for the SyncAccount: the config gate, the install-stable
// vault id, and the sign-in guard that fires before any network call. The
// Better Auth round-trip itself needs a live coordinator and is out of scope
// here (exercised end-to-end against the deployed Worker).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SyncAccount } from "../sync-account";

let tmp: string;

function accountAt(dir: string): SyncAccount {
  return new SyncAccount({
    configPath: path.join(dir, "sync-config.json"),
    authPath: path.join(dir, "sync-auth.json"),
    vaultIdPath: path.join(dir, "sync-vault-id.json"),
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-account-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("SyncAccount config", () => {
  it("defaults to disabled with an empty coordinator URL", () => {
    expect(accountAt(tmp).getConfig()).toEqual({ enabled: false, coordinatorUrl: "" });
  });

  it("patches one field at a time, leaving the other untouched", () => {
    const account = accountAt(tmp);
    account.setConfig({ coordinatorUrl: "https://sync.example" });
    expect(account.getConfig()).toEqual({
      enabled: false,
      coordinatorUrl: "https://sync.example",
    });
    account.setConfig({ enabled: true });
    expect(account.getConfig()).toEqual({
      enabled: true,
      coordinatorUrl: "https://sync.example",
    });
  });

  it("persists config across account instances (round-trips to disk)", () => {
    accountAt(tmp).setConfig({ enabled: true, coordinatorUrl: "https://sync.example" });
    expect(accountAt(tmp).getConfig()).toEqual({
      enabled: true,
      coordinatorUrl: "https://sync.example",
    });
  });
});

describe("SyncAccount vault id", () => {
  it("mints a stable id on first use and keeps it across instances", () => {
    const first = accountAt(tmp).getVaultId();
    expect(first).not.toBe("");
    // Same process, re-read.
    expect(accountAt(tmp).getVaultId()).toBe(first);
  });
});

describe("SyncAccount session", () => {
  it("starts signed out", () => {
    const account = accountAt(tmp);
    expect(account.getToken()).toBeNull();
    expect(account.getEmail()).toBeNull();
  });

  it("refuses sign-in with no coordinator URL (before any network call)", async () => {
    const result = await accountAt(tmp).signIn("a@b.c", "pw");
    expect(result).toEqual({ ok: false, error: "Set a coordinator URL first." });
  });
});
