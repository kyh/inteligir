// Device-auth store tests: token mint → validate, hash-at-rest (the store
// file never contains a usable credential), revocation, and the one-time /
// 10-minute-TTL pairing tokens (clock injected).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DeviceAuthStore, LOCAL_DEVICE_ID } from "../device-auth";

let tmp: string;

function storeAt(dir: string, now?: () => number): DeviceAuthStore {
  return new DeviceAuthStore({ devicesPath: path.join(dir, "remote-devices.json"), now });
}

function pairedDevice(store: DeviceAuthStore): { deviceId: string; deviceToken: string } {
  const pairing = store.createPairingToken();
  const result = store.redeemPairingToken(pairing.token, "Pixel");
  if (!result.ok) throw new Error(`pairing failed: ${result.error}`);
  return { deviceId: result.deviceId, deviceToken: result.deviceToken };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "device-auth-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("local token", () => {
  it("validates as the local session; a wrong token validates as null", () => {
    const store = storeAt(tmp);
    expect(store.validate(store.getLocalToken())).toEqual({
      deviceId: LOCAL_DEVICE_ID,
      name: "This device",
    });
    expect(store.validate("not-the-token")).toBeNull();
  });

  it("is per-boot: a new store instance mints a different token", () => {
    expect(storeAt(tmp).getLocalToken()).not.toBe(storeAt(tmp).getLocalToken());
  });
});

describe("pairing + device tokens", () => {
  it("redeems a pairing token into a device token that validates", () => {
    const store = storeAt(tmp);
    const { deviceId, deviceToken } = pairedDevice(store);
    expect(store.validate(deviceToken)).toEqual({ deviceId, name: "Pixel" });
    expect(store.listDevices().map((d) => d.name)).toEqual(["Pixel"]);
  });

  it("pairing tokens are single-use", () => {
    const store = storeAt(tmp);
    const pairing = store.createPairingToken();
    expect(store.redeemPairingToken(pairing.token, "One").ok).toBe(true);
    expect(store.redeemPairingToken(pairing.token, "Two")).toEqual({
      ok: false,
      error: "invalid or expired pairing token",
    });
  });

  it("pairing tokens expire after 10 minutes", () => {
    let clock = 1_000_000;
    const store = storeAt(tmp, () => clock);
    const pairing = store.createPairingToken();
    expect(pairing.expiresAt).toBe(clock + 10 * 60 * 1000);
    clock = pairing.expiresAt + 1;
    expect(store.redeemPairingToken(pairing.token, "Late").ok).toBe(false);
  });

  it("an unknown pairing token is rejected without consuming pending ones", () => {
    const store = storeAt(tmp);
    const pairing = store.createPairingToken();
    expect(store.redeemPairingToken("guess", "Evil").ok).toBe(false);
    expect(store.redeemPairingToken(pairing.token, "Real").ok).toBe(true);
  });

  it("stores tokens hashed — the file never contains a raw token", () => {
    const store = storeAt(tmp);
    const pairing = store.createPairingToken();
    const result = store.redeemPairingToken(pairing.token, "Pixel");
    if (!result.ok) throw new Error("pairing failed");

    const file = fs.readFileSync(path.join(tmp, "remote-devices.json"), "utf8");
    expect(file).not.toContain(result.deviceToken);
    expect(file).not.toContain(pairing.token);
    expect(file).not.toContain(store.getLocalToken());
    const expectedHash = crypto.createHash("sha256").update(result.deviceToken).digest("hex");
    expect(file).toContain(expectedHash);
  });

  it("device tokens survive a store restart (hash re-read from disk)", () => {
    const { deviceId, deviceToken } = pairedDevice(storeAt(tmp));
    expect(storeAt(tmp).validate(deviceToken)).toEqual({ deviceId, name: "Pixel" });
  });
});

describe("revocation", () => {
  it("a revoked device's token stops validating immediately", () => {
    const store = storeAt(tmp);
    const { deviceId, deviceToken } = pairedDevice(store);
    expect(store.revokeDevice(deviceId)).toBe(true);
    expect(store.validate(deviceToken)).toBeNull();
    expect(store.listDevices()).toEqual([]);
  });

  it("revoking an unknown id reports false", () => {
    expect(storeAt(tmp).revokeDevice("nope")).toBe(false);
  });
});

describe("logout wipe (revokeAll)", () => {
  it("drops paired devices and pending pairing tokens; the local token survives", () => {
    const store = storeAt(tmp);
    const { deviceToken } = pairedDevice(store);
    const pending = store.createPairingToken();

    store.revokeAll();
    expect(store.validate(deviceToken)).toBeNull();
    expect(store.redeemPairingToken(pending.token, "Late").ok).toBe(false);
    expect(store.listDevices()).toEqual([]);
    expect(store.validate(store.getLocalToken())).toEqual({
      deviceId: LOCAL_DEVICE_ID,
      name: "This device",
    });
  });

  it("wipes the warm cache, so a closed store can't validate or resurrect post-rm", () => {
    const store = storeAt(tmp);
    const { deviceId, deviceToken } = pairedDevice(store);

    // Mirror teardown order: wipe, close, THEN rm — like logout does.
    store.revokeAll();
    store.close();
    const file = path.join(tmp, "remote-devices.json");
    fs.rmSync(file, { force: true });

    // The warm in-memory cache refuses the old credential…
    expect(store.validate(deviceToken)).toBeNull();
    // …and a late write through the stale reference can't re-create the file.
    store.touchDevice(deviceId);
    expect(fs.existsSync(file)).toBe(false);
  });
});
