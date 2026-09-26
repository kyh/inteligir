import { describe, expect, it } from "vitest";
import { createKeychainCredentials } from "../secure-store-credential";
import type { Keychain } from "../secure-store-credential";
import { serializeCredential } from "../credential-codec";

// stand-ins for expo-secure-store's native constants: its default, a level a backup carries to a
// new phone, and the one this app writes
const WHEN_UNLOCKED = 5;
const AFTER_FIRST_UNLOCK = 0;
const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 1;

interface Item {
  value: string;
  accessible: number;
}

// the Keychain as expo-secure-store drives it: a set over a key that holds an item updates the
// value alone, and the item keeps the accessibility it was added with
const fakeKeychain = (held: Record<string, Item> = {}) => {
  const items = new Map(Object.entries(held));
  const keychain: Keychain = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    deleteItemAsync: async (key) => {
      items.delete(key);
    },
    getItemAsync: async (key) => items.get(key)?.value ?? null,
    setItemAsync: async (key, value, options = {}) => {
      const accessible = items.get(key)?.accessible ?? options.keychainAccessible ?? WHEN_UNLOCKED;
      items.set(key, { accessible, value });
    },
  };
  return { items, keychain };
};

const CREDENTIAL = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" };

describe("the phone's stored credential", () => {
  it("is kept for this phone alone, so no backup restores it onto another", async () => {
    const { items, keychain } = fakeKeychain();
    const credentials = createKeychainCredentials(keychain);

    await credentials.write(CREDENTIAL);

    expect(items.get("device-credential")?.accessible).toBe(AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY);
    expect(await credentials.read()).toStrictEqual(CREDENTIAL);
  });

  it("replaces a revoked credential still stored, rather than keeping its accessibility", async () => {
    const revoked = { credential: `igd_${"b".repeat(64)}`, deviceId: "dev_0" };
    const { items, keychain } = fakeKeychain({
      "device-credential": { accessible: AFTER_FIRST_UNLOCK, value: serializeCredential(revoked) },
    });
    const credentials = createKeychainCredentials(keychain);

    await credentials.write(CREDENTIAL);

    expect(items.get("device-credential")?.accessible).toBe(AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY);
    expect(await credentials.read()).toStrictEqual(CREDENTIAL);
    await credentials.clear();
    expect(await credentials.read()).toBeNull();
  });
});
