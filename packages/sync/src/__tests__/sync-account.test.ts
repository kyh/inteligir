// Store-level tests for the SyncAccount: the server-URL config and the auth
// guards that fire before any network call. The full Better Auth round-trip
// needs a live server and is out of scope here (exercised end-to-end against
// the real Worker in apps/web tests); the fetch-stubbed cases below pin the
// token-capture and social-initiation contracts without one.

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
  it("defaults to no server and reports a signed-out state", () => {
    expect(accountAt(tmp).getState()).toEqual({ signedIn: false, email: null, serverUrl: "" });
  });

  it("persists the server URL across account instances (round-trips to disk)", () => {
    accountAt(tmp).setServerUrl("https://inteligir.example");
    expect(accountAt(tmp).getServerUrl()).toBe("https://inteligir.example");
  });
});

describe("SyncAccount session", () => {
  it("starts signed out", () => {
    const account = accountAt(tmp);
    expect(account.getToken()).toBeNull();
    expect(account.getEmail()).toBeNull();
  });

  it("refuses sign-in with no server URL (before any network call)", async () => {
    const result = await accountAt(tmp).signIn("a@b.c", "pw");
    expect(result).toEqual({ ok: false, error: "Set a server URL first." });
  });

  it("refuses sign-up, social sign-in, and reset requests with no server URL", async () => {
    const account = accountAt(tmp);
    expect(await account.signUp("a@b.c", "pw")).toEqual({
      ok: false,
      error: "Set a server URL first.",
    });
    expect(await account.socialSignIn("github")).toEqual({
      ok: false,
      error: "Set a server URL first.",
    });
    expect(await account.requestPasswordReset("a@b.c")).toEqual({
      ok: false,
      error: "Set a server URL first.",
    });
  });
});

// ---------------------------------------------------------------------------
// Fetch-stubbed auth flows — the Better Auth client runs on global fetch, so
// stubbing it exercises the REAL client against pinned wire shapes.
// ---------------------------------------------------------------------------

describe("SyncAccount auth flows (stubbed server)", () => {
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
    account.setServerUrl("https://sync.example");
    const result = await account.signUp("new@example.com", "pw");
    expect(result).toEqual({ ok: true });
    expect(account.getToken()).toBe("bearer-token");
    expect(account.getEmail()).toBe("new@example.com");
  });

  it("socialSignIn opens the server's authorization URL and does NOT sign in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ url: "https://github.com/login/oauth/authorize?x=1" })),
    );
    const opened: string[] = [];
    const account = accountAt(tmp, {
      openExternal: (url) => {
        opened.push(url);
      },
    });
    account.setServerUrl("https://sync.example");
    const result = await account.socialSignIn("github");
    expect(result).toEqual({ ok: true });
    expect(opened).toEqual(["https://github.com/login/oauth/authorize?x=1"]);
    // Initiation only: the session lands in the browser; this device stays
    // signed out until the `session?code=…` deep link comes back.
    expect(account.getToken()).toBeNull();
  });

  it("socialSignIn refuses as a VALUE when no browser opener is installed", async () => {
    // No openExternal override and no setSyncBrowserOpener seam fill: the
    // sign-in must fail {ok:false} — never a silent package-owned fallback.
    const account = accountAt(tmp);
    account.setServerUrl("https://sync.example");
    const result = await account.socialSignIn("github");
    expect(result.ok).toBe(false);
  });

  it("requestPasswordReset hits the server's reset endpoint and stays NEUTRAL", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { body?: unknown }) => {
        calls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : "" });
        // The server's answer is identical for known and unknown emails —
        // this stub IS that neutral 200.
        return Response.json({
          status: true,
          message: "If this email exists in our system, check your email for the reset link",
        });
      }),
    );
    const account = accountAt(tmp);
    account.setServerUrl("https://sync.example");
    const result = await account.requestPasswordReset("who@example.com");
    // ok = request accepted, NEVER "that email exists": the renderer shows its
    // own fixed neutral copy, and nothing server-side reaches the UI.
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        url: "https://sync.example/api/auth/request-password-reset",
        // redirectTo is the server's own Worker-hosted reset page.
        body: JSON.stringify({ email: "who@example.com", redirectTo: "/auth/reset" }),
      },
    ]);
    // No auth state changes until the user signs in with the new password.
    expect(account.getToken()).toBeNull();

    // Transport failures surface as values (and reveal nothing about accounts).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const failed = await account.requestPasswordReset("who@example.com");
    expect(failed.ok).toBe(false);
  });

  it("getCapabilities parses the server's social list and fails soft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ socialProviders: ["github", "google"] })),
    );
    const account = accountAt(tmp);
    account.setServerUrl("https://sync.example");
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

/** Initiate a social sign-in against a stubbed server and capture the state
 * nonce from the callbackURL the client sent. */
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
    account.setServerUrl("https://sync.example");
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
    account.setServerUrl("https://sync.example");
    const result = await account.completeSocialSignIn(SOCIAL_CODE, "s".repeat(22));
    expect(result.ok).toBe(false);
    expect(noNetwork).not.toHaveBeenCalled();
    expect(account.getToken()).toBeNull();
  });

  it("refuses a WRONG state before any network call, WITHOUT burning the pending", async () => {
    const account = accountAt(tmp, { openExternal: () => {} });
    account.setServerUrl("https://sync.example");
    const state = await initiateSocial(account);

    // A junk `inteligir://session` fired at this machine (grammar-valid but
    // wrong state) is refused with no network call — and crucially must NOT
    // cancel the user's real pending sign-in (the anti-griefing property).
    const exchange = vi.fn(async () =>
      Response.json({ ok: true, token: "exchanged-bearer", email: "who@example.com" }),
    );
    vi.stubGlobal("fetch", exchange);
    expect((await account.completeSocialSignIn(SOCIAL_CODE, "x".repeat(22))).ok).toBe(false);
    expect(exchange).not.toHaveBeenCalled();
    expect(account.getToken()).toBeNull();

    // The legitimate deep link with the CORRECT state still completes — the
    // wrong guess did not burn it. (Brute-forcing the 128-bit state over the
    // 90s window is infeasible, so not burning on a mismatch costs nothing.)
    expect(await account.completeSocialSignIn(SOCIAL_CODE, state)).toEqual({ ok: true });
    expect(account.getToken()).toBe("exchanged-bearer");
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("surfaces an exchange rejection ({ok:false}) without signing in", async () => {
    const account = accountAt(tmp, { openExternal: () => {} });
    account.setServerUrl("https://sync.example");
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
    account.setServerUrl("https://sync.example");
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
// Account sign-out touches ONLY the session store.
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
    accountAt(tmp).setServerUrl("https://sync.example");
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
    // The server URL survives: sign-out is NOT a teardown.
    expect(fresh.getServerUrl()).toBe("https://sync.example");
  });
});
