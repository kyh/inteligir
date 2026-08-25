import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { readDeviceCredential } from "./credential-store";

// ---------------------------------------------------------------------------
// Where the vault's git remote comes from, resolved PER PASS rather than at
// boot: an explicit remote (INTELIGIR_VAULT_REMOTE / config.json) always
// wins, and with none set, a PAIRED install derives the hosted one from the
// cloud origin plus the device credential. The credential file stays the one
// switch — pairing turns vault sync on, unpairing turns it off, and there is
// no second flag to disagree with it (the same argument the thread-sync
// runtime states for itself).
//
// THE CREDENTIAL RIDES PER-INVOCATION ENV, NEVER THE URL. The engine
// persists the remote URL into `<vault>/.git/config` (`ensureOriginRemote`),
// which lives inside the directory users back up and copy — URL userinfo
// would store the secret there, and `redactRemoteUrl` covers display only.
// `GIT_CONFIG_*` env scopes an `http.<url>.extraHeader` to exactly the
// hosted remote's own URL, so no other remote a user configures ever sees
// the header.
// ---------------------------------------------------------------------------

/** A resolved remote: where to dial, and the env that authenticates the
 *  invocations that dial it. Resolved together so the URL and its credential
 *  cannot disagree. */
export interface VaultRemoteSpec {
  url: string;
  /** "explicit" = the user configured it; "paired" = derived from the device
   *  credential, and gone the moment an unpair removes that file. */
  source: "explicit" | "paired";
  /** Extra env for the network git invocations (fetch/push/clone) only. */
  env?: Record<string, string>;
}

/** Re-read wherever the answer matters — a sync pass, a status read, boot —
 *  so pair/unpair flips vault sync live, with no engine restart. */
export type VaultRemoteProvider = () => VaultRemoteSpec | null;

export function hostedVaultRemoteUrl(cloudUrl: string): string {
  return `${cloudUrl}${VAULT_GIT_PATH}`;
}

export interface CreateVaultRemoteProviderArgs {
  /** The configured remote (env/config.json), or null when none is set. */
  explicitRemote: string | null;
  cloudUrl: string;
  /** Where the device credential lives; its presence IS the derived switch. */
  dataDir: string;
}

export function createVaultRemoteProvider(
  args: CreateVaultRemoteProviderArgs,
): VaultRemoteProvider {
  return () => {
    if (args.explicitRemote !== null) {
      return { url: args.explicitRemote, source: "explicit" };
    }
    const credential = readDeviceCredential(args.dataDir);
    if (credential === null) {
      return null;
    }
    const url = hostedVaultRemoteUrl(args.cloudUrl);
    return {
      url,
      source: "paired",
      env: {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `http.${url}.extraHeader`,
        GIT_CONFIG_VALUE_0: `Authorization: Bearer ${credential.credential}`,
      },
    };
  };
}
