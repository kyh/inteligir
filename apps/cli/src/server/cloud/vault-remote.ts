import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { endpointUrl } from "@repo/api/cloud/client";
import type { ExternalSync } from "@repo/api/local/vault/vault-schema";
import { readDeviceCredential } from "./credential-store";

// resolved per pass, not at boot, so sign-in / sign-out flips vault sync live. the
// credential rides per-invocation env, never the url: the engine persists the
// remote url into <vault>/.git/config, which users back up and copy.

// pending: signed in, but the /v1/account fetch that names the account has not landed yet.
type VaultRemoteAccount = { state: "pending" } | { state: "known"; id: string };

interface VaultRemoteBase {
  url: string;
  /** for the network git invocations (fetch/push/clone) only. */
  env?: Record<string, string>;
}

export type VaultRemoteSpec =
  | (VaultRemoteBase & { source: "explicit" })
  | (VaultRemoteBase & { source: "account"; account: VaultRemoteAccount });

// the vault repo's own record of where it syncs, as its config states it: the origin's url, and
// whether the app marked that origin as the account's (`inteligir.remote=account`).
export interface OriginConfig {
  url: string | null;
  markedAccount: boolean;
}

export const NO_ORIGIN: OriginConfig = { markedAccount: false, url: null };

// read from the vault's own config every pass, so a remote the user sets there is the next pass's
export type VaultRemoteProvider = (origin: OriginConfig) => VaultRemoteSpec | null;

export const hostedVaultRemoteUrl = (cloudUrl: string): string =>
  endpointUrl(cloudUrl, VAULT_GIT_PATH);

// the url of an origin the user set, or null when there is none or it is the app's own: the
// marker, or the hosted url itself, which covers a vault that synced before the marker existed.
export const ownOriginUrl = (origin: OriginConfig, hostedUrl: string): string | null =>
  origin.url === null || origin.markedAccount || origin.url === hostedUrl ? null : origin.url;

export interface CreateVaultRemoteProviderArgs {
  // INTELIGIR_VAULT_REMOTE, over whatever the vault's own origin says.
  pinnedRemote: string | null;
  cloudUrl: string;
  dataDir: string;
  // judged once at boot: a folder another service syncs never takes the hosted vault.
  externalSync: ExternalSync | null;
}

export const createVaultRemoteProvider = (
  args: CreateVaultRemoteProviderArgs,
): VaultRemoteProvider => {
  const url = hostedVaultRemoteUrl(args.cloudUrl);
  const provider = (origin: OriginConfig): VaultRemoteSpec | null => {
    if (args.pinnedRemote !== null) {
      return { source: "explicit", url: args.pinnedRemote };
    }
    // the user's own remote keeps working inside a folder another service syncs.
    const own = ownOriginUrl(origin, url);
    if (own !== null) {
      return { source: "explicit", url: own };
    }
    if (args.externalSync !== null) {
      return null;
    }
    const credential = readDeviceCredential(args.dataDir);
    if (credential === null) {
      return null;
    }
    return {
      account:
        credential.userId === undefined
          ? { state: "pending" }
          : { id: credential.userId, state: "known" },
      env: {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `http.${url}.extraHeader`,
        GIT_CONFIG_VALUE_0: `Authorization: Bearer ${credential.credential}`,
      },
      source: "account",
      url,
    };
  };
  return provider;
};
