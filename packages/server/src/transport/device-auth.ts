// ---------------------------------------------------------------------------
// Device auth for the WS transport — the paired-device store, one-time
// pairing tokens, and the per-boot local-renderer token. Self-contained (no
// cloud dependency): tokens are minted here and stored HASHED (sha-256 hex)
// in remote-devices.json, so the file never contains a usable credential.
// The ws host consumes only the `TokenValidator` port, which a future
// cloud-backed validator (Better Auth) can implement instead.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { type Static, Type } from "@sinclair/typebox";

import {
  JsonStore,
  inteligirPath,
  rejectLegacyVersion,
  type FsAdapter,
} from "@repo/storage/json-store";
import type { RemoteDeviceInfo } from "@repo/bridge/remote-access";

const DEVICES_VERSION = 1;
const PAIRING_TOKEN_TTL_MS = 10 * 60 * 1000;

const RemoteDeviceSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    tokenHash: Type.String(),
    createdAt: Type.String(),
    lastSeenAt: Type.String(),
  },
  { additionalProperties: false },
);

const RemoteDevicesSchema = Type.Object(
  {
    version: Type.Literal(DEVICES_VERSION),
    devices: Type.Array(RemoteDeviceSchema),
  },
  { additionalProperties: false },
);

type StoredDevices = Static<typeof RemoteDevicesSchema>;

const DEFAULT_DEVICES: StoredDevices = { version: DEVICES_VERSION, devices: [] };

/** deviceId is `LOCAL_DEVICE_ID` for the loopback renderer's per-boot token. */
export type DeviceSession = { deviceId: string; name: string };

/** The only surface the ws host consumes — the seam where a cloud-backed
 * validator slots in later. */
export type TokenValidator = { validate: (token: string) => DeviceSession | null };

export const LOCAL_DEVICE_ID = "local";

export type PairingRedeemResult =
  | { ok: true; deviceId: string; deviceToken: string }
  | { ok: false; error: string };

function mintToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Hash both sides first so the buffers always have equal length —
// timingSafeEqual throws on a length mismatch.
function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export type DeviceAuthOptions = {
  fs?: FsAdapter | undefined;
  devicesPath?: string | undefined;
  /** Injectable clock for pairing-expiry tests. */
  now?: (() => number) | undefined;
};

/** Paired-device persistence + token validation. Pairing tokens live only in
 * memory (single-use, 10 min TTL); the local renderer token is minted per
 * boot and never persisted — it is always valid, loopback being the only
 * place it is ever handed out. */
export class DeviceAuthStore {
  private readonly store: JsonStore<StoredDevices>;
  private readonly now: () => number;
  private readonly localToken = mintToken();
  private readonly localTokenHash = hashToken(this.localToken);
  private pairings: Array<{ tokenHash: string; expiresAt: number }> = [];

  constructor(opts: DeviceAuthOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.store = new JsonStore<StoredDevices>(
      opts.devicesPath ?? inteligirPath("remote-devices.json"),
      RemoteDevicesSchema,
      DEFAULT_DEVICES,
      {
        fs: opts.fs,
        mode: 0o600,
        versioning: { current: DEVICES_VERSION, fromLegacy: rejectLegacyVersion("remote-devices") },
      },
    );
  }

  getLocalToken(): string {
    return this.localToken;
  }

  /** Mint a one-time pairing token (in-memory only; expires in 10 minutes). */
  createPairingToken(): { token: string; expiresAt: number } {
    this.prunePairings();
    const token = mintToken();
    const expiresAt = this.now() + PAIRING_TOKEN_TTL_MS;
    this.pairings.push({ tokenHash: hashToken(token), expiresAt });
    return { token, expiresAt };
  }

  /** Exchange a pairing token for a durable device token. Single-use: the
   * pairing token is consumed whether or not it was the one presented. */
  redeemPairingToken(pairingToken: string, deviceName: string): PairingRedeemResult {
    this.prunePairings();
    const presentedHash = hashToken(pairingToken);
    const index = this.pairings.findIndex((p) => hashesEqual(p.tokenHash, presentedHash));
    if (index === -1) return { ok: false, error: "invalid or expired pairing token" };
    this.pairings.splice(index, 1);
    const deviceToken = mintToken();
    const id = crypto.randomUUID();
    const timestamp = new Date(this.now()).toISOString();
    this.store.update((current) => ({
      version: DEVICES_VERSION,
      devices: [
        ...current.devices,
        {
          id,
          name: deviceName,
          tokenHash: hashToken(deviceToken),
          createdAt: timestamp,
          lastSeenAt: timestamp,
        },
      ],
    }));
    return { ok: true, deviceId: id, deviceToken };
  }

  validate(token: string): DeviceSession | null {
    const presentedHash = hashToken(token);
    if (hashesEqual(presentedHash, this.localTokenHash)) {
      return { deviceId: LOCAL_DEVICE_ID, name: "This device" };
    }
    for (const device of this.store.read().devices) {
      if (hashesEqual(presentedHash, device.tokenHash)) {
        return { deviceId: device.id, name: device.name };
      }
    }
    return null;
  }

  listDevices(): RemoteDeviceInfo[] {
    return this.store.read().devices.map(({ id, name, createdAt, lastSeenAt }) => ({
      id,
      name,
      createdAt,
      lastSeenAt,
    }));
  }

  /** Remove a paired device; its token stops validating immediately. */
  revokeDevice(id: string): boolean {
    let removed = false;
    this.store.update((current) => {
      const devices = current.devices.filter((device) => device.id !== id);
      removed = devices.length !== current.devices.length;
      return { version: DEVICES_VERSION, devices };
    });
    return removed;
  }

  /** Drop every paired device and pending pairing token (logout teardown).
   * The wipe must hit the warm in-memory state, not just disk: teardown
   * rm -rf's ~/.inteligir right after, and a warm cache would otherwise keep
   * validating (or resurrect) credentials the wipe was meant to destroy. The
   * per-boot local token survives — the local renderer keeps its session. */
  revokeAll(): void {
    this.pairings = [];
    this.store.update(() => DEFAULT_DEVICES);
  }

  /** Record a successful device auth (best-effort bookkeeping). */
  touchDevice(id: string): void {
    const timestamp = new Date(this.now()).toISOString();
    this.store.update((current) => ({
      version: DEVICES_VERSION,
      devices: current.devices.map((device) =>
        device.id === id ? { ...device, lastSeenAt: timestamp } : device,
      ),
    }));
  }

  close(): void {
    this.store.close();
  }

  private prunePairings(): void {
    const now = this.now();
    this.pairings = this.pairings.filter((p) => p.expiresAt > now);
  }
}
