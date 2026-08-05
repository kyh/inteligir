// The desktop end of the device-key model: generate the pair, split it between
// the SecretStore and a plain JSON store, and mint the assertion the
// coordinator verifies. The property that has to hold byte-for-byte is the
// founding one — the vaultId must be the fingerprint of THIS key's raw public
// bytes, computed here exactly as the Durable Object recomputes it — because
// that is what makes founding arithmetic rather than a race to be first.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SecretStore } from "@repo/storage/secrets";
import {
  base64UrlDecode,
  deviceAssertionSignedBytes,
  ED25519_PUBLIC_KEY_BYTES,
  isValidVaultId,
  parseDeviceAssertion,
  vaultIdFromKeyDigest,
} from "@repo/notes/sync/wire";

import { DeviceIdentity } from "../device-identity";

let tmp: string;

function identityAt(dir: string): DeviceIdentity {
  const secrets = new SecretStore({
    storePath: path.join(dir, "secrets.json"),
    cipher: {
      kind: "safe-storage",
      isAvailable: () => false,
      encrypt: (plaintext) => plaintext,
      decrypt: (data) => data,
    },
  });
  return new DeviceIdentity({
    storePath: path.join(dir, "sync-device.json"),
    secrets: () => secrets,
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "device-identity-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("DeviceIdentity", () => {
  it("has no device until one is founded", () => {
    expect(identityAt(tmp).current()).toBeNull();
  });

  it("founds a vault whose id is the fingerprint of the key's raw public bytes", () => {
    const device = identityAt(tmp).found();
    const raw = base64UrlDecode(device.publicKey);
    expect(raw?.length).toBe(ED25519_PUBLIC_KEY_BYTES);
    if (raw === undefined || raw === null) throw new Error("unreachable");
    expect(device.vaultId).toBe(
      vaultIdFromKeyDigest(new Uint8Array(createHash("sha256").update(raw).digest())),
    );
    expect(isValidVaultId(device.vaultId)).toBe(true);
  });

  it("is idempotent, and survives a reopen of the same store", () => {
    const founded = identityAt(tmp).found();
    expect(identityAt(tmp).found()).toEqual(founded);
    expect(identityAt(tmp).current()).toEqual(founded);
  });

  it("mints an assertion the public key verifies", () => {
    const identity = identityAt(tmp);
    const device = identity.found();
    const assertion = parseDeviceAssertion(identity.mintAssertion(device.vaultId));
    expect(assertion).not.toBeNull();
    if (assertion === null) throw new Error("unreachable");
    expect(assertion.payload.vid).toBe(device.vaultId);
    expect(assertion.payload.exp - assertion.payload.iat).toBe(300);
    const raw = base64UrlDecode(device.publicKey) ?? new Uint8Array();
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(raw)]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    expect(verify(null, assertion.signedBytes, key, assertion.signature)).toBe(true);
    // The bytes signed are the domain-separated payload, never the payload
    // alone — a signature over one shape must not verify as another.
    const [encodedPayload] = identity.mintAssertion(device.vaultId).split(".");
    expect(assertion.signedBytes).toEqual(deviceAssertionSignedBytes(encodedPayload ?? ""));
  });

  it("refuses to sign with no device, and says why when the key is unreadable", () => {
    const identity = identityAt(tmp);
    expect(() => identity.mintAssertion("v1")).toThrow(/no sync key/);
    const device = identity.found();
    // A keychain the app can no longer read leaves the public half behind —
    // the vault stays identifiable, and the failure names its own remedy.
    new SecretStore({
      storePath: path.join(tmp, "secrets.json"),
      cipher: {
        kind: "safe-storage",
        isAvailable: () => false,
        encrypt: (plaintext) => plaintext,
        decrypt: (data) => data,
      },
    }).delete("sync.device-key");
    const reopened = identityAt(tmp);
    expect(reopened.current()).toEqual(device);
    expect(() => reopened.mintAssertion(device.vaultId)).toThrow(/unreadable/);
  });

  it("forgetting drops both halves — the local side of disconnecting a vault", () => {
    const identity = identityAt(tmp);
    identity.found();
    identity.forget();
    expect(identity.current()).toBeNull();
    expect(identityAt(tmp).current()).toBeNull();
  });
});
