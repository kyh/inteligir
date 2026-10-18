// the extension's MV3 manifest, one function of its flavor: the dev build the e2e and a checkout
// load, the store zip, and the unpacked store build a release check loads. Only the store zip lacks
// the key, so the dev and unpacked builds carry the committed id the native host's manifest allows.
// wxt.config.ts hands it to WXT and refuses a build whose manifest.json says anything else.

import {
  DEV_NATIVE_HOST_NAME,
  EXTENSION_PUBLIC_KEY,
  NATIVE_HOST_NAME,
} from "@repo/contract/browser/extension-identity";

const EXTENSION_FLAVORS = ["dev", "store", "store-unpacked"] as const;
export type ExtensionFlavor = (typeof EXTENSION_FLAVORS)[number];

// a build's flavor is its WXT mode: `--mode store` is the store's (the zip hook in wxt.config.ts
// writes the unpacked store build from it), and every other mode, `wxt` and `wxt build` included,
// is the dev build, which dials the dev host
export const flavorOfMode = (mode: string): ExtensionFlavor => (mode === "store" ? "store" : "dev");

// which native host each flavor dials: the dev build reaches the manifest `inteligir native-host
// --install` writes for a checkout, the store builds the one the desktop app writes
export const nativeHostNameFor = (flavor: ExtensionFlavor): string =>
  flavor === "dev" ? DEV_NATIVE_HOST_NAME : NATIVE_HOST_NAME;

const ICON_SIZES = [16, 32, 48, 128] as const;

const icons = Object.fromEntries(
  ICON_SIZES.map((size) => [String(size), `icons/icon-${size}.png`]),
);

interface ExtensionManifest {
  action: { default_icon: Record<string, string>; default_popup: string; default_title: string };
  background: { service_worker: string; type: "module" };
  commands: { _execute_action: Record<string, never> };
  description: string;
  host_permissions?: string[];
  icons: Record<string, string>;
  key?: string;
  manifest_version: 3;
  minimum_chrome_version: string;
  name: string;
  permissions: string[];
  version: string;
}

export const extensionManifest = (flavor: ExtensionFlavor, version: string): ExtensionManifest => {
  const manifest: ExtensionManifest = {
    action: {
      default_icon: icons,
      default_popup: "popup.html",
      default_title: "Save to Inteligir",
    },
    background: { service_worker: "background.js", type: "module" },
    // the toolbar's shortcut, which the person chooses in the browser's own settings
    commands: { _execute_action: {} },
    description: "Save the page you're on to your Inteligir library.",
    icons,
    manifest_version: 3,
    minimum_chrome_version: "116",
    name: "Inteligir",
    permissions: ["activeTab", "contextMenus", "nativeMessaging", "scripting"],
    version,
  };
  // the store zip carries no key: the Web Store signs the item with its own
  if (flavor !== "store") {
    manifest.key = EXTENSION_PUBLIC_KEY;
  }
  // the dev build alone may script the e2e's loopback fixture pages without a click
  if (flavor === "dev") {
    manifest.host_permissions = ["http://127.0.0.1/*", "http://localhost/*"];
  }
  return manifest;
};
