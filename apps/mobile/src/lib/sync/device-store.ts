// ---------------------------------------------------------------------------
// Where this device's enrollment lives: the vault it joined, and the key that
// proves it. PURE — storage is an injected string port (production binds
// expo-secure-store in ./device.ts; tests use a Map).
//
// The two halves are stored under SEPARATE keys and written in a fixed order:
// the secret first, then the record. A record without its key is a device that
// can name a vault and never authenticate to it, which reads as "sync is
// broken" rather than "this device is not enrolled". The reverse — a stray
// secret with no record — is inert.
//
// Both halves sit in the keychain, unlike desktop (which keeps the public half
// outside the cipher so a lost keychain still names the vault). The phone has
// nothing to salvage: it never founds, so the answer to any unreadable key is
// the same one paste from the desktop.
//
// Anything malformed reads as "not enrolled", never a throw: the record is a
// cache of one paste, and re-pairing is cheap.
// ---------------------------------------------------------------------------

import { isRecord } from "@repo/notes/sync/guards";
import { base64UrlDecode, ED25519_PUBLIC_KEY_BYTES, isValidVaultId } from "@repo/notes/sync/wire";

// The same one-key-one-string seam the host pairing already persists through —
// one storage port for the app, bound once per platform.
import type { StringStorePort } from "../host/environment-store";
import type { DeviceKeyPair } from "./device-key";

/** The vault this device enrolled into, as the pairing blob described it. */
export type EnrolledDevice = {
  /**
   * Coordinator origin to call. It comes from the BLOB, not from app config: a
   * self-hoster's phone has to reach the Worker the desktop actually named.
   */
  readonly url: string;
  /** The desktop-founded vault. Mobile never mints one of these. */
  readonly vaultId: string;
  /** base64url of this device's raw Ed25519 public key — its roster row. */
  readonly publicKey: string;
  /** Epoch ms this device enrolled — display only. */
  readonly enrolledAt: number;
};

export type DeviceStore = {
  /** The enrollment, or null when this device has none. */
  get(): EnrolledDevice | null;
  /** Both key halves, or null when either is missing/unreadable. */
  key(): DeviceKeyPair | null;
  /** Persist an enrollment and the secret that backs it. */
  save(device: EnrolledDevice, secretKey: string): void;
  /** Forget the key and the enrollment — the local half of "disconnect". */
  clear(): void;
};

const KEY_STORE_KEY = "inteligir.deviceKey";
const DEVICE_STORE_KEY = "inteligir.device";
const STORE_VERSION = 1;

export function createDeviceStore(port: StringStorePort): DeviceStore {
  const read = (): EnrolledDevice | null => {
    const text = port.get(DEVICE_STORE_KEY);
    return text === null ? null : parseStored(text);
  };
  return {
    get: read,
    key: () => {
      const device = read();
      if (device === null) return null;
      const secretKey = port.get(KEY_STORE_KEY);
      return secretKey === null || secretKey === ""
        ? null
        : { secretKey, publicKey: device.publicKey };
    },
    save: (device, secretKey) => {
      port.set(KEY_STORE_KEY, secretKey);
      port.set(DEVICE_STORE_KEY, JSON.stringify({ version: STORE_VERSION, device }));
    },
    clear: () => {
      port.delete(DEVICE_STORE_KEY);
      port.delete(KEY_STORE_KEY);
    },
  };
}

function parseStored(text: string): EnrolledDevice | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw["version"] !== STORE_VERSION) return null;
  return parseDevice(raw["device"]);
}

/**
 * Validate a stored enrollment. The same three fields the coordinator will be
 * held to on the wire: an http(s) origin, a self-certifying vaultId, and a
 * public key that is 32 raw bytes.
 */
function parseDevice(raw: unknown): EnrolledDevice | null {
  if (!isRecord(raw)) return null;
  const { url, vaultId, publicKey, enrolledAt } = raw;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return null;
  if (typeof vaultId !== "string" || !isValidVaultId(vaultId)) return null;
  if (typeof publicKey !== "string") return null;
  const key = base64UrlDecode(publicKey);
  if (key === null || key.length !== ED25519_PUBLIC_KEY_BYTES) return null;
  if (typeof enrolledAt !== "number" || !Number.isFinite(enrolledAt)) return null;
  return { url, vaultId, publicKey, enrolledAt };
}
