import { describe, expect, it } from "vitest";
import { keychainStorage } from "./keychain-storage";
import type { Keychain } from "./keychain-storage";

// stand-ins for expo-secure-store's native constants: its default, which a backup carries to a
// new phone, and the one this app writes
const WHEN_UNLOCKED = 5;
const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;

interface Item {
  value: string;
  accessible: number;
}

// the Keychain as expo-secure-store drives it, each item kept with the accessibility it was written at
const fakeKeychain = () => {
  const items = new Map<string, Item>();
  const keychain: Keychain = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    getItem: (key) => items.get(key)?.value ?? null,
    getItemAsync: async (key) => await Promise.resolve(items.get(key)?.value ?? null),
    setItem: (key, value, options = {}) => {
      items.set(key, { accessible: options.keychainAccessible ?? WHEN_UNLOCKED, value });
    },
    setItemAsync: async (key, value, options = {}) => {
      items.set(key, { accessible: options.keychainAccessible ?? WHEN_UNLOCKED, value });
      await Promise.resolve();
    },
  };
  return { items, keychain };
};

describe("the Keychain the phone's session is kept in", () => {
  it("keeps every write for this phone alone, so no backup restores it onto another, and only while unlocked", async () => {
    const { items, keychain } = fakeKeychain();
    const storage = keychainStorage(keychain);

    storage.setItem("inteligir_cookie", "{}");
    await storage.setItemAsync("inteligir_cookie.0", "chunk");

    expect([...items.values()].map(({ accessible }) => accessible)).toStrictEqual([
      WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    ]);
    expect(storage.getItem("inteligir_cookie")).toBe("{}");
    await expect(storage.getItemAsync("inteligir_cookie.0")).resolves.toBe("chunk");
  });
});
