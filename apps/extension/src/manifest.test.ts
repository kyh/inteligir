import {
  DEV_NATIVE_HOST_NAME,
  EXTENSION_PUBLIC_KEY,
  NATIVE_HOST_NAME,
} from "@repo/contract/browser/extension-identity";
import { describe, expect, it } from "vitest";
import { extensionManifest, flavorOfMode, nativeHostNameFor } from "@/manifest";

describe("the manifest", () => {
  it("carries the key and the loopback hosts only in the dev build", () => {
    const dev = extensionManifest("dev", "0.1.0");
    expect(dev).toMatchObject({
      host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
      key: EXTENSION_PUBLIC_KEY,
    });
    expect(nativeHostNameFor("dev")).toBe(DEV_NATIVE_HOST_NAME);
  });

  it("carries neither in the store zip, and the key alone in the unpacked store build", () => {
    const store = extensionManifest("store", "0.1.0");
    expect("key" in store).toBe(false);
    expect("host_permissions" in store).toBe(false);
    const unpacked = extensionManifest("store-unpacked", "0.1.0");
    expect(unpacked).toMatchObject({ key: EXTENSION_PUBLIC_KEY });
    expect("host_permissions" in unpacked).toBe(false);
    expect(nativeHostNameFor("store")).toBe(NATIVE_HOST_NAME);
    expect(nativeHostNameFor("store-unpacked")).toBe(NATIVE_HOST_NAME);
  });

  it("asks for activeTab, never every site", () => {
    expect(extensionManifest("store", "0.1.0").permissions).toEqual([
      "activeTab",
      "contextMenus",
      "nativeMessaging",
      "scripting",
    ]);
  });
});

describe("a build's flavor", () => {
  it("is the store's for --mode store, and the dev build's for any other mode", () => {
    expect(flavorOfMode("store")).toBe("store");
    expect(flavorOfMode("development")).toBe("dev");
    expect(flavorOfMode("production")).toBe("dev");
  });
});
