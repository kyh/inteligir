import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { clearDeviceCredential, writeDeviceCredential } from "../credential-store";
import { createVaultRemoteProvider, hostedVaultRemoteUrl } from "../vault-remote";

const CLOUD_URL = "https://cloud.test";
const CREDENTIAL = `igd_${"a".repeat(64)}`;

function makeDataDir(): string {
  return makeTempDir("inteligir-vault-remote-");
}

describe("createVaultRemoteProvider", () => {
  it("answers null for an unpaired install with no explicit remote", () => {
    const provider = createVaultRemoteProvider({
      explicitRemote: null,
      cloudUrl: CLOUD_URL,
      dataDir: makeDataDir(),
    });
    expect(provider()).toBeNull();
  });

  it("derives the hosted remote from the credential, with the header env scoped to its URL", () => {
    const dataDir = makeDataDir();
    writeDeviceCredential(dataDir, { deviceId: "dev_1", credential: CREDENTIAL });
    const provider = createVaultRemoteProvider({
      explicitRemote: null,
      cloudUrl: CLOUD_URL,
      dataDir,
    });
    const remote = provider();
    expect(remote).not.toBeNull();
    if (remote === null) throw new Error("unreachable");
    expect(remote.url).toBe(hostedVaultRemoteUrl(CLOUD_URL));
    expect(remote.source).toBe("paired");
    expect(remote.env).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `http.${remote.url}.extraHeader`,
      GIT_CONFIG_VALUE_0: `Authorization: Bearer ${CREDENTIAL}`,
    });
  });

  it("flips live: pairing turns the remote on, unpairing turns it off", () => {
    const dataDir = makeDataDir();
    const provider = createVaultRemoteProvider({
      explicitRemote: null,
      cloudUrl: CLOUD_URL,
      dataDir,
    });
    expect(provider()).toBeNull();
    writeDeviceCredential(dataDir, { deviceId: "dev_1", credential: CREDENTIAL });
    expect(provider()?.source).toBe("paired");
    clearDeviceCredential(dataDir);
    expect(provider()).toBeNull();
  });

  it("an explicit remote wins over the derivation, and carries no header env", () => {
    const dataDir = makeDataDir();
    writeDeviceCredential(dataDir, { deviceId: "dev_1", credential: CREDENTIAL });
    const provider = createVaultRemoteProvider({
      explicitRemote: "https://github.com/kyh/vault.git",
      cloudUrl: CLOUD_URL,
      dataDir,
    });
    const remote = provider();
    expect(remote).toEqual({ url: "https://github.com/kyh/vault.git", source: "explicit" });
  });
});
