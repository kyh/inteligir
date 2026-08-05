// ---------------------------------------------------------------------------
// DeviceIdentity — this install's Ed25519 sync key, and the vault it founds.
//
// The device-key model replaces "an account owns the vault" with "a set of
// enrolled public keys owns it, and the vaultId is the fingerprint of the
// founder's key" (apps/cloud/README.md § Device keys). This module is the
// desktop end of it: generate the pair, keep the halves in the two places that
// suit them, and mint the short-lived assertion the coordinator accepts as a
// bearer credential.
//
// WHERE THE HALVES LIVE, and why they differ:
//   - the PRIVATE key (PKCS8 DER, base64) goes in the SecretStore — safeStorage
//     -encrypted where the OS has a keyring, 0600 either way. It is the only
//     thing here that is a secret.
//   - the PUBLIC key (base64url of the raw 32 bytes) goes in a plain
//     `sync-device.json` beside `sync-config.json`. It is not a secret, and
//     keeping it out of the cipher means the vaultId — which is derived from
//     it — survives a keychain the app can no longer read, so the failure
//     reads as "this device needs a new key" rather than "which vault was
//     this?".
//
// Desktop FOUNDS, mobile only ever enrolls: the vault is this machine's folder
// on disk, and a phone-founded vault is two vaultIds that never converge.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { type Static, Type } from "@sinclair/typebox";

import { JsonStore, inteligirPath, type FsAdapter } from "@repo/storage/json-store";
import { getSecretStore, type SecretStore } from "@repo/storage/secrets";
import {
  base64UrlDecode,
  deviceAssertionSignedBytes,
  DEVICE_ASSERTION_VERSION,
  encodeDeviceAssertionPayload,
  formatDeviceAssertion,
  vaultIdFromKeyDigest,
} from "@repo/notes/sync/wire";
import type { SyncDeviceInfo } from "@repo/bridge/sync";

/** SecretStore key holding the PKCS8 private key, base64. */
const DEVICE_KEY_SECRET = "sync.device-key";

const DEVICE_VERSION = 1;

/**
 * How long a minted assertion claims to live. The coordinator refuses anything
 * over 600s and tolerates 60s of forward skew, so this sits comfortably inside
 * both: short enough that a captured header dies quickly, long enough that a
 * mildly wrong clock still authenticates.
 */
const ASSERTION_LIFETIME_SECONDS = 300;

const SyncDeviceSchema = Type.Object(
  {
    version: Type.Literal(DEVICE_VERSION),
    /** base64url of the raw Ed25519 public key; null when this install has no device key. */
    publicKey: Type.Union([Type.String(), Type.Null()]),
    /** Epoch ms the key was generated — display only. */
    foundedAt: Type.Union([Type.Number(), Type.Null()]),
  },
  { additionalProperties: false },
);

type StoredDevice = Static<typeof SyncDeviceSchema>;

const DEFAULT_DEVICE: StoredDevice = {
  version: DEVICE_VERSION,
  publicKey: null,
  foundedAt: null,
};

export type DeviceIdentityOptions = {
  fs?: FsAdapter;
  storePath?: string;
  /** Resolved lazily so a DeviceIdentity can be constructed before createHost
   * installs the platform cipher. Tests pass a store over a fake cipher. */
  secrets?: () => SecretStore;
};

/** This install's device key: found it, forget it, sign with it. */
export class DeviceIdentity {
  private readonly store: JsonStore<StoredDevice>;
  private readonly secrets: () => SecretStore;

  constructor(opts: DeviceIdentityOptions = {}) {
    this.secrets = opts.secrets ?? getSecretStore;
    this.store = new JsonStore<StoredDevice>(
      opts.storePath ?? inteligirPath("sync-device.json"),
      SyncDeviceSchema,
      DEFAULT_DEVICE,
      { fs: opts.fs, versioning: { current: DEVICE_VERSION } },
    );
  }

  /** This device and the vault it founds, or null when no key has been
   * generated. Reads only the public half — a device whose private key has
   * become unreadable still reports here, and fails loudly at `mintAssertion`
   * instead of silently looking like a fresh install. */
  current(): SyncDeviceInfo | null {
    const { publicKey, foundedAt } = this.store.read();
    if (publicKey === null) return null;
    const vaultId = vaultIdOf(publicKey);
    return vaultId === null ? null : { publicKey, vaultId, foundedAt: foundedAt ?? 0 };
  }

  /**
   * Generate this install's key and adopt the vault it founds. Idempotent by
   * refusal: an existing device is returned untouched, because replacing it
   * would silently orphan a remote vault the user is still syncing.
   */
  found(): SyncDeviceInfo {
    const existing = this.current();
    if (existing !== null) return existing;
    const pair = crypto.generateKeyPairSync("ed25519");
    const jwk = pair.publicKey.export({ format: "jwk" });
    const publicKey = jwk.x;
    if (typeof publicKey !== "string") {
      throw new Error("sync: generated key exported no public component");
    }
    const vaultId = vaultIdOf(publicKey);
    if (vaultId === null) throw new Error("sync: generated key derives no vault id");
    // The secret first: a public key persisted without its private half is a
    // device that can name a vault and never authenticate to it.
    const pkcs8 = pair.privateKey.export({ type: "pkcs8", format: "der" });
    this.secrets().set(DEVICE_KEY_SECRET, pkcs8.toString("base64"));
    const foundedAt = Date.now();
    this.store.write({ version: DEVICE_VERSION, publicKey, foundedAt });
    return { publicKey, vaultId, foundedAt };
  }

  /**
   * Forget this device's key — the local half of "disconnect this vault".
   * Never a coordinator call: the server cannot tell "I am leaving" from
   * "strand this vault", and it refuses the revoke that would do the latter.
   * The remote vault and its roster row are left exactly as they are, so
   * another enrolled device can still tombstone this key.
   */
  forget(): void {
    this.secrets().delete(DEVICE_KEY_SECRET);
    this.store.write(DEFAULT_DEVICE);
  }

  /**
   * Mint the bearer credential for one request: a self-issued assertion over
   * `{v, vid, dev, iat, exp}`, signed with this device's key. Minted PER
   * REQUEST rather than cached — it expires in minutes, and signing is cheaper
   * than reasoning about when a cached one went stale.
   */
  mintAssertion(vaultId: string): string {
    const device = this.current();
    if (device === null) throw new Error("sync: this device has no sync key");
    const stored = this.secrets().get(DEVICE_KEY_SECRET);
    if (stored === null) {
      throw new Error(
        "sync: this device's sync key is unreadable (the keychain may have changed) — " +
          "reconnect the vault in Settings › Sync to mint a new one",
      );
    }
    const iat = Math.floor(Date.now() / 1000);
    const encoded = encodeDeviceAssertionPayload({
      v: DEVICE_ASSERTION_VERSION,
      vid: vaultId,
      dev: device.publicKey,
      iat,
      exp: iat + ASSERTION_LIFETIME_SECONDS,
    });
    if (encoded === null) throw new Error("sync: could not encode a device assertion");
    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(stored, "base64"),
      format: "der",
      type: "pkcs8",
    });
    // Ed25519 signs the message itself — node requires a null digest algorithm.
    const signature = crypto.sign(null, deviceAssertionSignedBytes(encoded), privateKey);
    return formatDeviceAssertion(encoded, new Uint8Array(signature));
  }

  /** Disable writes on the underlying store (logout teardown). */
  close(): void {
    this.store.close();
  }
}

/** The vault a base64url public key founds, or null when it isn't one. */
function vaultIdOf(publicKey: string): string | null {
  const raw = base64UrlDecode(publicKey);
  if (raw === null) return null;
  return vaultIdFromKeyDigest(new Uint8Array(crypto.createHash("sha256").update(raw).digest()));
}
