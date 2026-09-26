import { describe, expect, it } from "vitest";
import type { ExternalSync } from "@repo/api/local/vault/vault-schema";
import { makeTempDir } from "../../__tests__/temp-dir";
import { clearDeviceCredential, writeDeviceCredential } from "../credential-store";
import { createVaultRemoteProvider, hostedVaultRemoteUrl, NO_ORIGIN } from "../vault-remote";
import type { CreateVaultRemoteProviderArgs, OriginConfig } from "../vault-remote";

const CLOUD_URL = "https://cloud.test";
const HOSTED_URL = hostedVaultRemoteUrl(CLOUD_URL);
const CREDENTIAL = `igd_${"a".repeat(64)}`;
const OWN_URL = "https://github.com/kyh/vault.git";
const PINNED_URL = "git@example.com:pinned/vault.git";
const ICLOUD: ExternalSync = { kind: "icloud-drive" };

const own = (url: string): OriginConfig => ({ markedAccount: false, url });

const makeDataDir = (): string => makeTempDir("inteligir-vault-remote-");

const signedInDataDir = (): string => {
  const dataDir = makeDataDir();
  writeDeviceCredential(dataDir, { credential: CREDENTIAL, deviceId: "dev_1", userId: "usr_1" });
  return dataDir;
};

const provider = (args: Partial<CreateVaultRemoteProviderArgs> & { dataDir: string }) =>
  createVaultRemoteProvider({
    cloudUrl: CLOUD_URL,
    externalSync: null,
    pinnedRemote: null,
    ...args,
  });

describe("createVaultRemoteProvider", () => {
  it("answers null for a signed-out install with no pin and no origin", () => {
    expect(provider({ dataDir: makeDataDir() })(NO_ORIGIN)).toBeNull();
  });

  it("derives the hosted remote from the credential, with the header env scoped to its URL", () => {
    const remote = provider({ dataDir: signedInDataDir() })(NO_ORIGIN);
    expect(remote).not.toBeNull();
    if (remote === null) {
      throw new Error("unreachable");
    }
    expect(remote.url).toBe(HOSTED_URL);
    expect(remote.source).toBe("account");
    expect(remote.env).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `http.${remote.url}.extraHeader`,
      GIT_CONFIG_VALUE_0: `Authorization: Bearer ${CREDENTIAL}`,
    });
  });

  it("says the account is pending until the credential names it, then carries its id", () => {
    const dataDir = makeDataDir();
    const derive = provider({ dataDir });
    writeDeviceCredential(dataDir, { credential: CREDENTIAL, deviceId: "dev_1" });
    expect(derive(NO_ORIGIN)).toMatchObject({ account: { state: "pending" }, source: "account" });
    writeDeviceCredential(dataDir, { credential: CREDENTIAL, deviceId: "dev_1", userId: "usr_1" });
    expect(derive(NO_ORIGIN)).toMatchObject({
      account: { id: "usr_1", state: "known" },
      source: "account",
    });
  });

  it("flips live: signing in turns the remote on, signing out turns it off", () => {
    const dataDir = makeDataDir();
    const derive = provider({ dataDir });
    expect(derive(NO_ORIGIN)).toBeNull();
    writeDeviceCredential(dataDir, { credential: CREDENTIAL, deviceId: "dev_1" });
    expect(derive(NO_ORIGIN)?.source).toBe("account");
    clearDeviceCredential(dataDir);
    expect(derive(NO_ORIGIN)).toBeNull();
  });

  describe("in order: the env pin, the vault's own origin, outside sync, the account", () => {
    it("the pin wins over the vault's own origin and the account, and carries no header env", () => {
      const derive = provider({
        dataDir: signedInDataDir(),
        externalSync: ICLOUD,
        pinnedRemote: PINNED_URL,
      });
      expect(derive(own(OWN_URL))).toEqual({ source: "pinned", url: PINNED_URL });
      expect(derive(NO_ORIGIN)).toEqual({ source: "pinned", url: PINNED_URL });
    });

    it("an origin the user set is the vault's remote, signed in or not", () => {
      expect(provider({ dataDir: signedInDataDir() })(own(OWN_URL))).toEqual({
        source: "explicit",
        url: OWN_URL,
      });
      expect(provider({ dataDir: makeDataDir() })(own(OWN_URL))).toEqual({
        source: "explicit",
        url: OWN_URL,
      });
    });

    it("the user's own origin keeps working inside a folder another service syncs", () => {
      const derive = provider({ dataDir: signedInDataDir(), externalSync: ICLOUD });
      expect(derive(own(OWN_URL))).toEqual({ source: "explicit", url: OWN_URL });
    });

    it("a folder another service syncs never takes the hosted vault, even signed in", () => {
      const derive = provider({ dataDir: signedInDataDir(), externalSync: ICLOUD });
      expect(derive(NO_ORIGIN)).toBeNull();
      expect(derive({ markedAccount: true, url: HOSTED_URL })).toBeNull();
    });
  });

  describe("an origin the app manages is never adopted as the user's own", () => {
    const MANAGED: readonly (readonly [string, OriginConfig])[] = [
      [
        "marked, at the url a previous deployment named",
        { markedAccount: true, url: "https://old.test/v1/git" },
      ],
      ["at the hosted url, from before the marker", { markedAccount: false, url: HOSTED_URL }],
      ["marked, with no origin yet", { markedAccount: true, url: null }],
    ];

    it.each(MANAGED)("%s: signed in, the account's", (_label, origin) => {
      expect(provider({ dataDir: signedInDataDir() })(origin)).toMatchObject({
        source: "account",
        url: HOSTED_URL,
      });
    });

    it.each(MANAGED)("%s: signed out, none", (_label, origin) => {
      expect(provider({ dataDir: makeDataDir() })(origin)).toBeNull();
    });
  });
});
