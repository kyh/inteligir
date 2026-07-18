// Store-level tests for the SyncAccount: the config gate, the install-stable
// vault id, and the auth guards that fire before any network call. The full
// Better Auth round-trip needs a live coordinator and is out of scope here
// (exercised end-to-end against the real Worker in apps/cloud tests); the
// fetch-stubbed cases below pin the token-capture and social-initiation
// contracts without one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SyncAccount, type SyncAccountOptions } from "../sync-account";

let tmp: string;

function accountAt(dir: string, opts: Partial<SyncAccountOptions> = {}): SyncAccount {
  return new SyncAccount({
    configPath: path.join(dir, "sync-config.json"),
    authPath: path.join(dir, "sync-auth.json"),
    vaultIdPath: path.join(dir, "sync-vault-id.json"),
    ...opts,
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

  it("refuses sign-up and social sign-in with no coordinator URL", async () => {
    const account = accountAt(tmp);
    expect(await account.signUp("a@b.c", "pw")).toEqual({
      ok: false,
      error: "Set a coordinator URL first.",
    });
    expect(await account.socialSignIn("github")).toEqual({
      ok: false,
      error: "Set a coordinator URL first.",
    });
  });
});

// ---------------------------------------------------------------------------
// Fetch-stubbed auth flows — the Better Auth client runs on global fetch, so
// stubbing it exercises the REAL client against pinned wire shapes.
// ---------------------------------------------------------------------------

describe("SyncAccount auth flows (stubbed coordinator)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signUp captures the set-auth-token header and signs the account in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { user: { id: "u1", email: "new@example.com", name: "new" }, token: "session-token" },
          { headers: { "set-auth-token": "bearer-token" } },
        ),
      ),
    );
    const account = accountAt(tmp);
    account.setConfig({ coordinatorUrl: "https://sync.example" });
    const result = await account.signUp("new@example.com", "pw");
    expect(result).toEqual({ ok: true });
    expect(account.getToken()).toBe("bearer-token");
    expect(account.getEmail()).toBe("new@example.com");
  });

  it("socialSignIn opens the coordinator's authorization URL and does NOT sign in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ url: "https://github.com/login/oauth/authorize?x=1" })),
    );
    const opened: string[] = [];
    const account = accountAt(tmp, { openExternal: (url) => opened.push(url) });
    account.setConfig({ coordinatorUrl: "https://sync.example" });
    const result = await account.socialSignIn("github");
    expect(result).toEqual({ ok: true });
    expect(opened).toEqual(["https://github.com/login/oauth/authorize?x=1"]);
    // Initiation only: the session lands in the browser; this device stays
    // signed out until Phase 4's deep-link callback captures it.
    expect(account.getToken()).toBeNull();
  });

  it("getCapabilities parses the coordinator's social list and fails soft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ socialProviders: ["github", "google"] })),
    );
    const account = accountAt(tmp);
    account.setConfig({ coordinatorUrl: "https://sync.example" });
    expect(await account.getCapabilities()).toEqual({ socialProviders: ["github", "google"] });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await account.getCapabilities()).toEqual({ socialProviders: [] });
    // No URL configured → no request at all.
    expect(
      await accountAt(tmp, { configPath: path.join(tmp, "other.json") }).getCapabilities(),
    ).toEqual({ socialProviders: [] });
  });
});

// ---------------------------------------------------------------------------
// Teardown decouple (#459): account sign-out touches ONLY the session store.
// ---------------------------------------------------------------------------

describe("SyncAccount sign-out isolation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signOut clears sync-auth.json and nothing else", async () => {
    // The best-effort remote revoke must not hit a real network.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const account = accountAt(tmp);
    account.setConfig({ enabled: true, coordinatorUrl: "https://sync.example" });
    const vaultId = account.getVaultId();
    // Establish a session directly in the store (the artifact signIn writes).
    fs.writeFileSync(
      path.join(tmp, "sync-auth.json"),
      JSON.stringify({ version: 1, token: "tok", email: "a@b.c" }),
    );
    const fresh = accountAt(tmp);
    expect(fresh.getToken()).toBe("tok");

    await fresh.signOut();

    expect(fresh.getToken()).toBeNull();
    expect(fresh.getEmail()).toBeNull();
    // Config + vault id survive: sign-out is NOT a teardown.
    expect(fresh.getConfig()).toEqual({ enabled: true, coordinatorUrl: "https://sync.example" });
    expect(fresh.getVaultId()).toBe(vaultId);
  });
});
