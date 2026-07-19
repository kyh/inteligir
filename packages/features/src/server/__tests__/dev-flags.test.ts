// The packaged-build hardening contract (dev-flags.ts): dev-only env flags
// are honored ONLY when boot allowed them (`!platform.isPackaged`). A
// packaged install — and a process where boot never decided — refuses the
// ambient env outright, for the flags AND the explicit OAuth URL overrides.

import { afterEach, describe, expect, it, vi } from "vitest";

import { areDevFlagsAllowed, setDevFlagsAllowed } from "../dev-flags";
import {
  isEmulateConnectorsEnabled,
  resolveGoogleOAuthEndpoints,
} from "../connectors/emulate-connectors";
import { isFauxAgentEnabled } from "../provider/faux-provider";
import { GOOGLE_AUTHORIZATION_URL, GOOGLE_TOKEN_URL } from "@repo/bridge/executor";

afterEach(() => {
  vi.unstubAllEnvs();
  setDevFlagsAllowed(false);
});

describe("dev-flags gate", () => {
  it("is fail-closed until boot decides", () => {
    expect(areDevFlagsAllowed()).toBe(false);
  });

  it("packaged (disallowed): both flags forced off regardless of env", () => {
    setDevFlagsAllowed(false);
    vi.stubEnv("INTELIGIR_FAUX_AGENT", "1");
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    expect(isFauxAgentEnabled()).toBe(false);
    expect(isEmulateConnectorsEnabled()).toBe(false);
  });

  it("packaged (disallowed): OAuth endpoints resolve real Google even with URL overrides set", () => {
    setDevFlagsAllowed(false);
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_AUTH_URL", "http://localhost:5999/auth");
    vi.stubEnv("INTELIGIR_GOOGLE_OAUTH_TOKEN_URL", "http://localhost:5999/token");
    expect(resolveGoogleOAuthEndpoints()).toEqual({
      authorizationUrl: GOOGLE_AUTHORIZATION_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
    });
  });

  it("unpackaged (allowed): env is honored", () => {
    setDevFlagsAllowed(true);
    vi.stubEnv("INTELIGIR_FAUX_AGENT", "1");
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    expect(isFauxAgentEnabled()).toBe(true);
    expect(isEmulateConnectorsEnabled()).toBe(true);
  });

  it("unpackaged (allowed) with no env set: flags stay off", () => {
    setDevFlagsAllowed(true);
    expect(isFauxAgentEnabled()).toBe(false);
    expect(isEmulateConnectorsEnabled()).toBe(false);
  });
});
