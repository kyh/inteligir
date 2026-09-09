import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { endpointUrl } from "@repo/api/cloud/client";
import { readDeviceCredential } from "./credential-store";

// resolved per pass, not at boot, so sign-in / sign-out flips vault sync live. the
// credential rides per-invocation env, never the url: the engine persists the
// remote url into <vault>/.git/config, which users back up and copy.

export interface VaultRemoteSpec {
  url: string;
  source: "explicit" | "account";
  /** what the engine's inteligir.account marker is compared against; absent, the fence is inert. */
  account?: string;
  /** for the network git invocations (fetch/push/clone) only. */
  env?: Record<string, string>;
}

export type VaultRemoteProvider = () => VaultRemoteSpec | null;

export const hostedVaultRemoteUrl = (cloudUrl: string): string =>
  endpointUrl(cloudUrl, VAULT_GIT_PATH);

export interface CreateVaultRemoteProviderArgs {
  explicitRemote: string | null;
  cloudUrl: string;
  dataDir: string;
}

export const createVaultRemoteProvider = (
  args: CreateVaultRemoteProviderArgs,
): VaultRemoteProvider => {
  const provider = (): VaultRemoteSpec | null => {
    if (args.explicitRemote !== null) {
      return { source: "explicit", url: args.explicitRemote };
    }
    const credential = readDeviceCredential(args.dataDir);
    if (credential === null) {
      return null;
    }
    const url = hostedVaultRemoteUrl(args.cloudUrl);
    const spec: VaultRemoteSpec = {
      env: {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `http.${url}.extraHeader`,
        GIT_CONFIG_VALUE_0: `Authorization: Bearer ${credential.credential}`,
      },
      source: "account",
      url,
    };
    if (credential.userId !== undefined) {
      spec.account = credential.userId;
    }
    return spec;
  };
  return provider;
};
