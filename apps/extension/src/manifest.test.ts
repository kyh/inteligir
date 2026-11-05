import { EXTENSION_PUBLIC_KEY } from "@repo/contract/cloud/extension/extension-identity";
import { describe, expect, it } from "vitest";

import { connectPagePattern, extensionManifest, flavorOfMode } from "./manifest";

describe("the manifest", () => {
  it("carries the key and the fixture pages' host only in the dev build", () => {
    const dev = extensionManifest("dev", "0.6.0");
    expect(dev).toMatchObject({
      host_permissions: ["http://127.0.0.1/*"],
      key: EXTENSION_PUBLIC_KEY,
    });
  });

  it("carries neither in the store zip, and the key alone in the unpacked store build", () => {
    const store = extensionManifest("store", "0.6.0");
    expect("key" in store).toBe(false);
    expect("host_permissions" in store).toBe(false);
    const unpacked = extensionManifest("store-unpacked", "0.6.0");
    expect(unpacked).toMatchObject({ key: EXTENSION_PUBLIC_KEY });
    expect("host_permissions" in unpacked).toBe(false);
  });

  it("asks for activeTab, never every site, and runs on the Chrome that has `browser`", () => {
    const store = extensionManifest("store", "0.6.0");
    expect(store.permissions).toEqual([
      "activeTab",
      "alarms",
      "contextMenus",
      "scripting",
      "storage",
    ]);
    expect(store.minimum_chrome_version).toBe("148");
  });

  it("lets only the site's connect page message it, the production site's in a store build", () => {
    expect(extensionManifest("store", "0.6.0").externally_connectable).toEqual({
      matches: ["https://inteligir.com/connect/extension"],
    });
    expect(connectPagePattern("store-unpacked")).toBe("https://inteligir.com/connect/extension");
    // a pattern with no port matches every port, as a local Worker's may be
    expect(extensionManifest("dev", "0.6.0").externally_connectable).toEqual({
      matches: ["http://localhost/connect/extension"],
    });
  });
});

describe("a build's flavor", () => {
  it("is the store's for --mode store, and the dev build's for any other mode", () => {
    expect(flavorOfMode("store")).toBe("store");
    expect(flavorOfMode("development")).toBe("dev");
    expect(flavorOfMode("production")).toBe("dev");
    expect(flavorOfMode("test")).toBe("dev");
  });
});
