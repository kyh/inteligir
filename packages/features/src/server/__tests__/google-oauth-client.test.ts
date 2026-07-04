import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureGoogleOAuthClient,
  getBundledGoogleClient,
  type BundledGoogleClient,
  type GoogleOAuthClientOps,
} from "../executor/google-oauth-client";
import {
  GOOGLE_AUTHORIZATION_URL,
  GOOGLE_OAUTH_CLIENT_SLUG,
  GOOGLE_TOKEN_URL,
  type CreateOAuthClientInput,
  type ExecutorOAuthClient,
} from "@repo/features/executor";

const BUNDLED: BundledGoogleClient = { clientId: "bundled-id", clientSecret: "bundled-secret" };

function client(over: Partial<ExecutorOAuthClient>): ExecutorOAuthClient {
  return {
    owner: "user",
    slug: GOOGLE_OAUTH_CLIENT_SLUG,
    grant: "authorization_code",
    authorizationUrl: GOOGLE_AUTHORIZATION_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    clientId: "users-own-id",
    origin: { kind: "manual" },
    ...over,
  };
}

function fakeOps(registered: ExecutorOAuthClient[] = []): GoogleOAuthClientOps & {
  created: CreateOAuthClientInput[];
} {
  // Stateful: a created client shows up in later list calls, so a second
  // ensure sees it as existing (register-once semantics).
  const clients = [...registered];
  const created: CreateOAuthClientInput[] = [];
  return {
    created,
    listOAuthClients: () => Promise.resolve([...clients]),
    createOAuthClient: (input) => {
      created.push(input);
      clients.push(client({ slug: input.slug, clientId: input.clientId }));
      return Promise.resolve({ client: input.slug });
    },
  };
}

describe("ensureGoogleOAuthClient", () => {
  it("seeds the bundled client when none is registered, then reports ready", async () => {
    const ops = fakeOps();
    const result = await ensureGoogleOAuthClient(ops, BUNDLED);
    expect(result).toEqual({ status: "ready", source: "bundled" });
    expect(ops.created).toEqual([
      {
        owner: "user",
        slug: GOOGLE_OAUTH_CLIENT_SLUG,
        authorizationUrl: GOOGLE_AUTHORIZATION_URL,
        tokenUrl: GOOGLE_TOKEN_URL,
        grant: "authorization_code",
        clientId: "bundled-id",
        clientSecret: "bundled-secret",
      },
    ]);
  });

  it("registers the bundled client once across repeated connects", async () => {
    const ops = fakeOps();
    await ensureGoogleOAuthClient(ops, BUNDLED);
    const second = await ensureGoogleOAuthClient(ops, BUNDLED);
    expect(second).toEqual({ status: "ready", source: "existing" });
    expect(ops.created).toHaveLength(1);
  });

  it("never overwrites an already-registered client with the bundled one", async () => {
    const ops = fakeOps([client({ clientId: "users-own-id" })]);
    const result = await ensureGoogleOAuthClient(ops, BUNDLED);
    expect(result).toEqual({ status: "ready", source: "existing" });
    expect(ops.created).toHaveLength(0);
  });

  it("reports unavailable (dialog fallback) when no bundled client and none registered", async () => {
    const ops = fakeOps();
    const result = await ensureGoogleOAuthClient(ops, null);
    expect(result).toEqual({ status: "unavailable" });
    expect(ops.created).toHaveLength(0);
  });

  it("a registered client satisfies ensure even without bundled credentials", async () => {
    const ops = fakeOps([client({})]);
    const result = await ensureGoogleOAuthClient(ops, null);
    expect(result).toEqual({ status: "ready", source: "existing" });
  });
});

// With no shell-provided client these exercise exactly the server/dev
// fallback: lazy process.env reads.
describe("getBundledGoogleClient (env fallback)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the client when both env vars are set", () => {
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_ID", "env-id");
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_SECRET", "env-secret");
    expect(getBundledGoogleClient()).toEqual({ clientId: "env-id", clientSecret: "env-secret" });
  });

  it("returns null when either var is missing or blank", () => {
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_ID", "env-id");
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_SECRET", "");
    expect(getBundledGoogleClient()).toBeNull();

    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_ID", "   ");
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_SECRET", "env-secret");
    expect(getBundledGoogleClient()).toBeNull();
  });

  it("returns null when neither var is set (bundled client absent)", () => {
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_SECRET", "");
    expect(getBundledGoogleClient()).toBeNull();
  });

  it("prefers the shell-provided client over the environment", () => {
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_ID", "env-id");
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_CLIENT_SECRET", "env-secret");
    expect(getBundledGoogleClient(BUNDLED)).toEqual(BUNDLED);
  });
});
