// The packaged-build hardening contract for the CONNECTORS side of the
// dev-flag gate (@repo/bridge/dev-flags): the emulate override and the
// explicit OAuth URL overrides are honored ONLY when boot allowed dev flags
// (`!platform.isPackaged`). A packaged install — and a process where boot
// never decided — refuses the ambient env outright. The faux-agent side of
// the same contract lives in @repo/agent's faux-provider.test.ts; the pure
// gate default is pinned in @repo/bridge's dev-flags.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";

import { setDevFlagsAllowed } from "@repo/bridge/dev-flags";
import { isEmulateConnectorsEnabled, resolveGoogleOAuthEndpoints } from "../emulate-connectors";
import { GOOGLE_AUTHORIZATION_URL, GOOGLE_TOKEN_URL } from "@repo/bridge/executor";

afterEach(() => {
  vi.unstubAllEnvs();
  setDevFlagsAllowed(false);
});

describe("dev-flags gate (connectors)", () => {
  it("packaged (disallowed): the emulate flag is forced off regardless of env", () => {
    setDevFlagsAllowed(false);
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
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
    vi.stubEnv("INTELIGIR_EMULATE_CONNECTORS", "1");
    expect(isEmulateConnectorsEnabled()).toBe(true);
  });

  it("unpackaged (allowed) with no env set: the flag stays off", () => {
    setDevFlagsAllowed(true);
    expect(isEmulateConnectorsEnabled()).toBe(false);
  });
});
