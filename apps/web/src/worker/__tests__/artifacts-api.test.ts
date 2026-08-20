import { artifactsMintResponseSchema } from "@repo/cloud-contract/artifacts";
import { cloudErrorSchema } from "@repo/cloud-contract/errors";
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceHeaders, pairDevice, signUpUser, userIdOf } from "./cloud-helpers";
import { deleteArtifactsRepo, handleArtifactsMint } from "../artifacts";

// The flag-ON half, driven against a STUBBED Cloudflare API.
//
// This account is beta-gated, so the live API cannot answer for these paths —
// but the SHAPE it answers with is documented, and getting it wrong is not a
// subtle failure: every v4 response wraps its payload in `{success, errors,
// messages, result}`, so reading the token off the response root mints a real
// token and then throws it away with a 500, forever. That is exactly the class
// of bug a stub catches and a beta gate hides, so the fixtures below are the
// documented envelope verbatim.
//
// The handler is called directly with a synthetic env because the flag is
// deployment configuration, not a request input — there is no way to ask the
// bound Worker for the enabled build.

const ACCOUNT_ID = "acct-1234";

function enabledEnv(): Env {
  return {
    ...env,
    ARTIFACTS_ENABLED: "true",
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: "cf-api-token",
  };
}

/** What the two Artifacts endpoints answer inside the envelope, as this test
 *  stubs them — every field optional because each case sends only what the
 *  assertion under it reads. */
interface ArtifactsResult {
  id?: string;
  name?: string;
  default_branch?: string;
  plaintext?: string;
  scope?: string;
  expires_at?: string;
}

/** The half of `fetch`'s init the code under test fills in. */
interface StubbedInit {
  method?: string;
  body?: string;
}

/** Cloudflare's v4 envelope. */
function v4(result: ArtifactsResult): Response {
  return Response.json({ success: true, errors: [], messages: [], result });
}

function mintRequest(credential: string): Request {
  return new Request("https://inteligir.com/v1/artifacts/mint", {
    method: "POST",
    headers: deviceHeaders(credential),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("artifacts mint (flag on, stubbed API)", () => {
  it("reads the token out of the v4 result envelope", async () => {
    const { bearer } = await signUpUser("artifacts-on@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    const userId = await userIdOf(bearer);

    const calls: { url: string; method: string; body: unknown }[] = [];
    // The stub declares what the code under test actually sends: a URL string
    // and a JSON body it stringified itself.
    vi.stubGlobal("fetch", async (input: string, init?: StubbedInit) => {
      const url = input;
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body === undefined ? null : JSON.parse(init.body),
      });
      if (url.endsWith("/repos")) {
        return v4({ id: "repo_123", name: `vault-${userId}`, default_branch: "main" });
      }
      return v4({
        id: "0123456789abcdef",
        plaintext: "art_v1_deadbeef?expires=1760000000",
        scope: "write",
        expires_at: "2026-09-15T00:00:00Z",
      });
    });

    const response = await handleArtifactsMint(mintRequest(credential), enabledEnv());
    expect(response.status).toBe(200);
    const minted = artifactsMintResponseSchema.parse(await response.json());
    expect(minted.token).toBe("art_v1_deadbeef?expires=1760000000");
    expect(minted.expiresAt).toBe(Date.parse("2026-09-15T00:00:00Z"));
    expect(minted.remote).toBe(
      `https://${ACCOUNT_ID}.artifacts.cloudflare.net/git/default/vault-${userId.toLowerCase()}.git`,
    );
    // A credential must never be cacheable by anything between here and the app.
    expect(response.headers.get("cache-control")).toBe("no-store");

    // The repo is named from the VERIFIED userId, and the token is scoped to it.
    expect(calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/default/repos`,
    );
    expect(calls[1]?.body).toMatchObject({
      repo: `vault-${userId.toLowerCase()}`,
      scope: "write",
    });
  });

  it("refuses when the API answers success:false — how a beta gate arrives", async () => {
    const { bearer } = await signUpUser("artifacts-gated@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");

    vi.stubGlobal("fetch", async () =>
      Response.json({
        success: false,
        errors: [{ code: 10004, message: "artifacts is not enabled for this account" }],
        messages: [],
        result: null,
      }),
    );

    const response = await handleArtifactsMint(mintRequest(credential), enabledEnv());
    expect(response.status).toBe(500);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("internal");
  });

  it("still demands the device credential before dialling Cloudflare", async () => {
    const dialled = vi.fn();
    vi.stubGlobal("fetch", async () => {
      dialled();
      return v4({});
    });

    const response = await handleArtifactsMint(
      new Request("https://inteligir.com/v1/artifacts/mint", { method: "POST" }),
      enabledEnv(),
    );
    expect(response.status).toBe(401);
    expect(dialled).not.toHaveBeenCalled();
  });
});

describe("artifacts repo deletion", () => {
  it("deletes the account's repo", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", async (input: string, init?: StubbedInit) => {
      calls.push({ url: input, method: init?.method ?? "GET" });
      return v4({ id: "repo_123" });
    });

    await deleteArtifactsRepo(enabledEnv(), "USER-Abc");
    expect(calls).toEqual([
      {
        url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/artifacts/namespaces/default/repos/vault-user-abc`,
        method: "DELETE",
      },
    ]);
  });

  it("treats a missing repo as already deleted", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    await expect(deleteArtifactsRepo(enabledEnv(), "user-1")).resolves.toBeUndefined();
  });

  it("THROWS on any other failure, so the account survives to ask again", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 500 }));
    await expect(deleteArtifactsRepo(enabledEnv(), "user-1")).rejects.toThrow(
      "artifacts repo delete failed: 500",
    );
  });

  it("does nothing at all when this deployment hosts no Artifacts", async () => {
    const dialled = vi.fn();
    vi.stubGlobal("fetch", async () => {
      dialled();
      return v4({});
    });
    // env has no ARTIFACTS_ENABLED — there is no repo, so there is nothing to
    // delete and nothing to fail on.
    await deleteArtifactsRepo(env, "user-1");
    expect(dialled).not.toHaveBeenCalled();
  });
});
