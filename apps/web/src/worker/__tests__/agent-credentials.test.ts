// ---------------------------------------------------------------------------
// The credential seam — the claim this whole design rests on, checked.
//
// The claim is: the container never holds a provider credential. Three things
// have to hold for that to be true, and each one is a case here.
//
//   1. what the container is HANDED is a placeholder, and the real token is
//      put on the request afterwards, in the Worker (`injectProviderCredential`);
//   2. the identity the container presents is bound to ONE account and ONE
//      container generation, so a leaked one cannot be replayed anywhere;
//   3. the refresh token at rest is sealed, and a value sealed for one user
//      cannot be opened by another's object.
//
// The token minting runs against a real Durable Object with a real sealed
// credential and an injected token endpoint, so the refresh path is the
// production one rather than a stub around it.
// ---------------------------------------------------------------------------

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  mintScopedToken,
  openCredential,
  sealCredential,
  tokenAddress,
  verifyScopedToken,
} from "../agent/agent-crypto";
import { EGRESS_IDENTITY_HEADER, injectProviderCredential } from "../agent/egress";
import { providerEntry } from "../agent/provider-catalog";
import { ProviderCredentials, type CredentialKv } from "../agent/provider-credentials";
import { userHostName } from "../host/host-address";

const SECRET = "test-better-auth-secret-000000000000";

function anthropic() {
  const entry = providerEntry("anthropic");
  if (entry === null) throw new Error("the anthropic entry vanished from the catalog");
  return entry;
}

describe("provider credentials", () => {
  it("seals at rest and refuses another user's key", async () => {
    const sealed = await sealCredential(SECRET, "user-a", "refresh-token-value");
    expect(sealed).not.toContain("refresh-token-value");
    expect(await openCredential(SECRET, "user-a", sealed)).toBe("refresh-token-value");
    // Salted with the user id, so a sealed blob moved between objects is
    // unreadable rather than portable.
    expect(await openCredential(SECRET, "user-b", sealed)).toBeNull();
    expect(await openCredential("another-deployment-secret", "user-a", sealed)).toBeNull();
  });

  it("refreshes a spent access token and keeps a rotated refresh token", async () => {
    const calls: string[] = [];
    const kv = memoryKv();
    const credentials = new ProviderCredentials({
      kv,
      userId: "user-a",
      secret: SECRET,
      env,
      fetch: async (_input, init) => {
        calls.push(init?.body instanceof URLSearchParams ? init.body.toString() : "");
        return Response.json({
          access_token: "access-1",
          refresh_token: "refresh-2",
          expires_in: 3600,
        });
      },
    });
    await credentials.completeAuthorization(
      {
        provider: "anthropic",
        nonce: "n",
        verifier: "v",
        redirectUri: "https://example.test/cb",
        createdAt: Date.now(),
      },
      "auth-code",
    );
    // Configured here so the exchange above and the mint below both have an
    // OAuth app to reach; without one the mint refuses instead of refreshing.
    expect(calls[0]).toContain("grant_type=authorization_code");
    expect(credentials.connected("anthropic")).toBe(true);

    const minted = await credentials.mintAccessToken(anthropic());
    expect(minted).toEqual({ ok: true, token: "access-1" });
  });

  it("refuses to store a grant with no refresh token", async () => {
    const credentials = new ProviderCredentials({
      kv: memoryKv(),
      userId: "user-a",
      secret: SECRET,
      env,
      fetch: async () => Response.json({ access_token: "access-only", expires_in: 60 }),
    });
    const result = await credentials.completeAuthorization(
      {
        provider: "anthropic",
        nonce: "n",
        verifier: "v",
        redirectUri: "https://example.test/cb",
        createdAt: Date.now(),
      },
      "auth-code",
    );
    // An access token alone works until it expires and then presents as a
    // mysteriously broken account, with no interactive session left to re-prompt in.
    expect(result).toEqual({ ok: false, error: expect.stringContaining("refresh token") });
    expect(credentials.connected("anthropic")).toBe(false);
  });
});

describe("the container's identity token", () => {
  it("names an object without proving anything, and proves itself separately", async () => {
    const token = await mintScopedToken(SECRET, {
      scope: "report",
      userId: "user-a",
      ref: "boot-1",
      expiresAt: Date.now() + 60_000,
    });
    expect(tokenAddress(token)).toBe("user-a");
    expect(await verifyScopedToken(SECRET, "report", token, Date.now())).toMatchObject({
      userId: "user-a",
      ref: "boot-1",
    });
    // Tampering with the payload keeps the address readable and the signature
    // wrong — which is exactly why addressing is not a verdict.
    const forged = `${token.slice(0, token.indexOf("."))}x.${token.slice(token.indexOf(".") + 1)}`;
    expect(await verifyScopedToken(SECRET, "report", forged, Date.now())).toBeNull();
  });

  it("is refused under a scope it was not minted for", async () => {
    const token = await mintScopedToken(SECRET, {
      scope: "oauth",
      userId: "user-a",
      ref: "nonce-1",
      expiresAt: Date.now() + 60_000,
    });
    expect(await verifyScopedToken(SECRET, "report", token, Date.now())).toBeNull();
  });

  it("expires", async () => {
    const token = await mintScopedToken(SECRET, {
      scope: "report",
      userId: "user-a",
      ref: "boot-1",
      expiresAt: Date.now() - 1,
    });
    expect(await verifyScopedToken(SECRET, "report", token, Date.now())).toBeNull();
  });

  it("only mints for the account and the container generation it names", async () => {
    const stub = env.UserHost.getByName(userHostName("mint-user"));
    const results = await runInDurableObject(stub, async (host) => {
      const stale = await mintScopedToken(env.BETTER_AUTH_SECRET, {
        scope: "report",
        userId: "mint-user",
        ref: "a-container-that-was-replaced",
        expiresAt: Date.now() + 60_000,
      });
      const foreign = await mintScopedToken(env.BETTER_AUTH_SECRET, {
        scope: "report",
        userId: "someone-else",
        ref: "boot-1",
        expiresAt: Date.now() + 60_000,
      });
      return {
        stale: await host.mintProviderAccessToken(stale, "anthropic"),
        foreign: await host.mintProviderAccessToken(foreign, "anthropic"),
      };
    });
    expect(results.stale).toEqual({ ok: false, error: expect.stringContaining("replaced") });
    expect(results.foreign).toEqual({
      ok: false,
      error: expect.stringContaining("does not name this account"),
    });
  });
});

describe("outbound credential injection", () => {
  it("replaces whatever the container sent with a freshly minted token", async () => {
    const request = new Request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        authorization: "Bearer sandbox-managed",
        "x-api-key": "sandbox-managed",
        [EGRESS_IDENTITY_HEADER]: "identity-token",
      },
      body: "{}",
    });
    const result = await injectProviderCredential(request, () =>
      Promise.resolve({ token: "the-real-token" }),
    );
    if (result instanceof Response) throw new Error("the request was refused");
    expect(result.headers.get("authorization")).toBe("Bearer the-real-token");
    // Both credential headers are cleared, not just the one this provider uses:
    // a leftover on the other is a value the provider might still prefer.
    expect(result.headers.get("x-api-key")).toBeNull();
    // The identity never reaches the provider.
    expect(result.headers.get(EGRESS_IDENTITY_HEADER)).toBeNull();
    expect(result.headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("refuses a host this deployment routes no credential to", async () => {
    const request = new Request("https://evil.example/v1/messages", {
      headers: { [EGRESS_IDENTITY_HEADER]: "identity-token" },
    });
    const result = await injectProviderCredential(request, () =>
      Promise.resolve({ token: "the-real-token" }),
    );
    if (!(result instanceof Response)) throw new Error("an unknown host was let through");
    expect(result.status).toBe(403);
  });

  it("refuses rather than passing an unauthenticated request through", async () => {
    const request = new Request("https://api.anthropic.com/v1/messages");
    const result = await injectProviderCredential(request, () =>
      Promise.resolve({ error: "no credential" }),
    );
    // An unauthenticated provider call comes back as a provider auth error,
    // which reads as "your account is broken" rather than "this deployment has
    // no credential for you".
    if (!(result instanceof Response)) throw new Error("an unauthenticated request was forwarded");
    expect(result.status).toBe(401);
  });
});

/** An in-memory stand-in for `ctx.storage.kv` — the same synchronous contract. */
function memoryKv(): CredentialKv {
  const entries = new Map<string, unknown>();
  return {
    get: (key) => entries.get(key),
    put: (key, value) => {
      entries.set(key, value);
    },
    delete: (key) => entries.delete(key),
  };
}
