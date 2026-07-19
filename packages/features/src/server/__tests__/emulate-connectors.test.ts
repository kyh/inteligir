import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDevFlagsAllowed } from "../dev-flags";
import {
  applyGoogleEndpointOverride,
  emulatePlaceholderGoogleClient,
  EMULATE_GOOGLE_AUTHORIZATION_URL,
  EMULATE_GOOGLE_TOKEN_URL,
  isEmulateConnectorsEnabled,
  resolveGoogleOAuthEndpoints,
} from "../connectors/emulate-connectors";
import {
  ensureGoogleOAuthClient,
  type GoogleOAuthClientOps,
} from "../connectors/google-oauth-client";
import {
  GOOGLE_AUTHORIZATION_URL,
  GOOGLE_TOKEN_URL,
  type CreateOAuthClientInput,
} from "@repo/bridge/executor";

// These tests exercise the env-driven behavior of an UNPACKAGED (dev) build,
// so opt in to dev flags; the packaged-refusal contract is dev-flags.test.ts.
beforeEach(() => {
  setDevFlagsAllowed(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setDevFlagsAllowed(false);
});

describe("isEmulateConnectorsEnabled", () => {
  it("is off by default and reads the env live", () => {
    expect(isEmulateConnectorsEnabled()).toBe(false);
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    expect(isEmulateConnectorsEnabled()).toBe(true);
  });

  it('requires exactly "1"', () => {
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "true");
    expect(isEmulateConnectorsEnabled()).toBe(false);
  });
});

describe("resolveGoogleOAuthEndpoints", () => {
  it("resolves the real-Google endpoints with no env set (production default)", () => {
    expect(resolveGoogleOAuthEndpoints()).toEqual({
      authorizationUrl: GOOGLE_AUTHORIZATION_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
    });
  });

  it("resolves the emulate endpoints under the flag (full URLs, token path differs)", () => {
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    expect(resolveGoogleOAuthEndpoints()).toEqual({
      authorizationUrl: EMULATE_GOOGLE_AUTHORIZATION_URL,
      tokenUrl: EMULATE_GOOGLE_TOKEN_URL,
    });
  });

  it("lets the explicit env overrides win over the flag's emulate defaults", () => {
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_AUTH_URL", "http://localhost:5999/auth");
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_TOKEN_URL", "http://localhost:5999/token");
    expect(resolveGoogleOAuthEndpoints()).toEqual({
      authorizationUrl: "http://localhost:5999/auth",
      tokenUrl: "http://localhost:5999/token",
    });
  });

  it("applies explicit overrides without the flag, per URL (the other stays real Google)", () => {
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_TOKEN_URL", "http://localhost:5999/token");
    expect(resolveGoogleOAuthEndpoints()).toEqual({
      authorizationUrl: GOOGLE_AUTHORIZATION_URL,
      tokenUrl: "http://localhost:5999/token",
    });
  });

  it("treats blank overrides as unset", () => {
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_AUTH_URL", "   ");
    expect(resolveGoogleOAuthEndpoints().authorizationUrl).toBe(GOOGLE_AUTHORIZATION_URL);
  });
});

describe("emulatePlaceholderGoogleClient", () => {
  it("is null with the flag off (no placeholder ever reaches production)", () => {
    expect(emulatePlaceholderGoogleClient()).toBeNull();
  });

  it("returns placeholder credentials under the flag", () => {
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    expect(emulatePlaceholderGoogleClient()).toEqual({
      clientId: "inteligir-emulate",
      clientSecret: "inteligir-emulate",
    });
  });
});

describe("applyGoogleEndpointOverride", () => {
  const googleInput: CreateOAuthClientInput = {
    owner: "user",
    slug: "google",
    authorizationUrl: GOOGLE_AUTHORIZATION_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    grant: "authorization_code",
    clientId: "id",
    clientSecret: "secret",
  };

  it("is an exact no-op with no env set", () => {
    expect(applyGoogleEndpointOverride(googleInput)).toEqual(googleInput);
  });

  it("swaps the baked real-Google endpoints for the emulate ones under the flag", () => {
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    expect(applyGoogleEndpointOverride(googleInput)).toEqual({
      ...googleInput,
      authorizationUrl: EMULATE_GOOGLE_AUTHORIZATION_URL,
      tokenUrl: EMULATE_GOOGLE_TOKEN_URL,
    });
  });

  it("passes non-Google endpoints through untouched even under the flag", () => {
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    const custom: CreateOAuthClientInput = {
      ...googleInput,
      authorizationUrl: "https://example.com/auth",
      tokenUrl: "https://example.com/token",
    };
    expect(applyGoogleEndpointOverride(custom)).toBe(custom);
  });
});

describe("ensureGoogleOAuthClient under the flag", () => {
  it("registers the shared client against the emulate endpoints", async () => {
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    const created: CreateOAuthClientInput[] = [];
    const ops: GoogleOAuthClientOps = {
      listOAuthClients: async () => [],
      createOAuthClient: async (input) => {
        created.push(input);
        return { client: input.slug };
      },
    };
    const result = await ensureGoogleOAuthClient(ops, emulatePlaceholderGoogleClient());
    expect(result).toEqual({ status: "ready", source: "bundled" });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      authorizationUrl: EMULATE_GOOGLE_AUTHORIZATION_URL,
      tokenUrl: EMULATE_GOOGLE_TOKEN_URL,
      clientId: "inteligir-emulate",
    });
  });
});
