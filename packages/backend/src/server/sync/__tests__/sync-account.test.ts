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
// Social sign-in COMPLETION — the deep-link callback's code+state exchange.
// The state-nonce bind is the anti-fixation guard: only the one pending
// sign-in this instance minted may complete, once.
// ---------------------------------------------------------------------------

const SOCIAL_CODE = "c".repeat(43);

/** Initiate a social sign-in against a stubbed coordinator and capture the
 * state nonce from the callbackURL the client sent. */
async function initiateSocial(account: SyncAccount): Promise<string> {
  let state: string | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = typeof init?.body === "string" ? init.body : "";
      const match = /desktop-callback\?state=([A-Za-z0-9_-]+)/.exec(body);
      if (match?.[1] !== undefined) state = match[1];
      return Response.json({ url: "https://accounts.example/authorize?x=1" });
    }),
  );
  const initiated = await account.socialSignIn("google");
  expect(initiated).toEqual({ ok: true });
  if (state === null) throw new Error("initiation sent no state nonce");
  return state;
}

describe("SyncAccount completeSocialSignIn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adopts the exchanged bearer when the state matches the pending sign-in", async () => {
    const account = accountAt(tmp, { openExternal: () => {} });
    account.setConfig({ coordinatorUrl: "https://sync.example" });
    const state = await initiateSocial(account);

    const exchange = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      expect(String(url)).toBe("https://sync.example/v1/auth/exchange");
      // The ONLY thing that crosses: the opaque code. Never the state, never
      // a token.
      expect(init?.body).toBe(JSON.stringify({ code: SOCIAL_CODE }));
      return Response.json({ ok: true, token: "exchanged-bearer", email: "who@example.com" });
    });
    vi.stubGlobal("fetch", exchange);

    expect(await account.completeSocialSignIn(SOCIAL_CODE, state)).toEqual({ ok: true });
    expect(account.getToken()).toBe("exchanged-bearer");
    expect(account.getEmail()).toBe("who@example.com");
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("refuses with NO pending sign-in — before any network call", async () => {
    const noNetwork = vi.fn(async () => {
      throw new Error("must not be called");
    });
    vi.stubGlobal("fetch", noNetwork);
    const account = accountAt(tmp);
    account.setConfig({ coordinatorUrl: "https://sync.example" });
    const result = await account.completeSocialSignIn(SOCIAL_CODE, "s".repeat(22));
    expect(result.ok).toBe(false);
    expect(noNetwork).not.toHaveBeenCalled();
    expect(account.getToken()).toBeNull();
  });

  it("refuses a WRONG state, and the guess burns the pending sign-in", async () => {
    const account = accountAt(tmp, { openExternal: () => {} });
    account.setConfig({ coordinatorUrl: "https://sync.example" });
    const state = await initiateSocial(account);

    const noNetwork = vi.fn(async () => {
      throw new Error("must not be called");
    });
    vi.stubGlobal("fetch", noNetwork);
    expect((await account.completeSocialSignIn(SOCIAL_CODE, "x".repeat(22))).ok).toBe(false);
    // Single try: even the CORRECT state is dead after a failed attempt.
    expect((await account.completeSocialSignIn(SOCIAL_CODE, state)).ok).toBe(false);
    expect(noNetwork).not.toHaveBeenCalled();
    expect(account.getToken()).toBeNull();
  });

  it("surfaces an exchange rejection ({ok:false}) without signing in", async () => {
    const account = accountAt(tmp, { openExternal: () => {} });
    account.setConfig({ coordinatorUrl: "https://sync.example" });
    const state = await initiateSocial(account);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, error: "This sign-in link is invalid." })),
    );
    expect(await account.completeSocialSignIn(SOCIAL_CODE, state)).toEqual({
      ok: false,
      error: "This sign-in link is invalid.",
    });
    expect(account.getToken()).toBeNull();
  });

  it("a completed sign-in is single-use too — replaying the deep link fails", async () => {
    const account = accountAt(tmp, { openExternal: () => {} });
    account.setConfig({ coordinatorUrl: "https://sync.example" });
    const state = await initiateSocial(account);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, token: "bearer-1", email: "a@b.c" })),
    );
    expect((await account.completeSocialSignIn(SOCIAL_CODE, state)).ok).toBe(true);
    expect((await account.completeSocialSignIn(SOCIAL_CODE, state)).ok).toBe(false);
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
