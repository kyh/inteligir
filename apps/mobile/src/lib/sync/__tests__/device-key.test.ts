import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import * as ed from "@noble/ed25519";

import { parseDeviceAssertion } from "@repo/notes/sync/wire";

import {
  generateDeviceKey,
  installRandomSource,
  mintDeviceAssertion,
  type DeviceKeyPair,
} from "../device-key";

// The CSPRNG install is MODULE state (vitest gives each test file its own
// registry, so it is local to this one) — which means the fail-closed case has
// to run before anything installs a source. Keep it first.
describe("device key", () => {
  it("refuses to generate a key before a random source is installed", () => {
    expect(() => generateDeviceKey()).toThrow(/secure random source/);
  });

  it("generates a keypair whose halves match", () => {
    installRandomSource(nodeRandomBytes);
    const key = generateDeviceKey();
    expect(key.secretKey).not.toBe(key.publicKey);
    const derived = ed.getPublicKey(decode(key.secretKey));
    expect(ed.etc.bytesToHex(derived)).toBe(ed.etc.bytesToHex(decode(key.publicKey)));
  });

  it("draws its key material from the installed source, not the ambient one", () => {
    const drawn: number[] = [];
    installRandomSource((length) => {
      drawn.push(length);
      return nodeRandomBytes(length);
    });
    generateDeviceKey();
    installRandomSource(nodeRandomBytes);
    expect(drawn).toEqual([32]);
  });

  it("mints an assertion the coordinator's own parser accepts", () => {
    installRandomSource(nodeRandomBytes);
    const key = generateDeviceKey();
    const vaultId = `v1${"a".repeat(52)}`;
    const nowMs = 1_770_000_000_000;

    const assertion = parseDeviceAssertion(mintDeviceAssertion(key, vaultId, nowMs));
    expect(assertion).not.toBeNull();
    if (assertion === null) return;

    expect(assertion.payload.vid).toBe(vaultId);
    expect(assertion.payload.dev).toBe(key.publicKey);
    expect(assertion.payload.iat).toBe(Math.floor(nowMs / 1000));
    expect(assertion.payload.exp - assertion.payload.iat).toBe(300);
    // The signature is what the Worker checks, against the key carried inside
    // the payload — verify exactly that pair rather than a mock of it.
    expect(ed.verify(assertion.signature, assertion.signedBytes, assertion.devicePublicKey)).toBe(
      true,
    );
  });

  it("refuses to sign with an unreadable secret key", () => {
    installRandomSource(nodeRandomBytes);
    const broken: DeviceKeyPair = { ...generateDeviceKey(), secretKey: "not-a-key" };
    expect(() => mintDeviceAssertion(broken, `v1${"b".repeat(52)}`, Date.now())).toThrow(
      /unreadable/,
    );
  });
});

function nodeRandomBytes(length: number): Uint8Array {
  return webcrypto.getRandomValues(new Uint8Array(length));
}

function decode(base64url: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64url, "base64url"));
}
