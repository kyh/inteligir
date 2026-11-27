import { EXTENSION_PUBLIC_KEY } from "@repo/contract/extension/extension-identity";
import { describe, expect, it } from "vitest";

import { extensionManifest, flavorOfMode } from "./manifest";

describe("the manifest", () => {
  it("carries the key, a local app's site and the fixture pages' host in the dev build", () => {
    const dev = extensionManifest("dev", "0.6.0");
    expect(dev).toMatchObject({
      host_permissions: ["http://localhost/*"],
      key: EXTENSION_PUBLIC_KEY,
    });
  });

  it("names the production site as its one host in the store builds, and the key in the unpacked one alone", () => {
    const store = extensionManifest("store", "0.6.0");
    expect("key" in store).toBe(false);
    expect(store.host_permissions).toStrictEqual(["https://www.inteligir.com/*"]);
    const unpacked = extensionManifest("store-unpacked", "0.6.0");
    expect(unpacked).toMatchObject({ key: EXTENSION_PUBLIC_KEY });
    expect(unpacked.host_permissions).toStrictEqual(["https://www.inteligir.com/*"]);
  });

  it("asks for activeTab and the site's cookies, never every site, and runs on the Chrome that has `browser`", () => {
    for (const flavor of ["dev", "store", "store-unpacked"] as const) {
      const manifest = extensionManifest(flavor, "0.6.0");
      expect(manifest.permissions, flavor).toStrictEqual([
        "activeTab",
        "alarms",
        "contextMenus",
        "cookies",
        "scripting",
        "storage",
      ]);
      expect(JSON.stringify(manifest), flavor).not.toContain("<all_urls>");
      expect(manifest.minimum_chrome_version, flavor).toBe("148");
    }
  });

  it("names the welcome page as its options in every build, so the browser can open it again", () => {
    for (const flavor of ["dev", "store", "store-unpacked"] as const) {
      expect(extensionManifest(flavor, "0.6.0").options_ui, flavor).toStrictEqual({
        open_in_tab: true,
        page: "welcome.html",
      });
    }
  });

  it("names no page that may message it, in any build", () => {
    for (const flavor of ["dev", "store", "store-unpacked"] as const) {
      expect(extensionManifest(flavor, "0.6.0"), flavor).not.toHaveProperty(
        "externally_connectable",
      );
    }
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
