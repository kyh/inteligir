// the extension's MV3 manifest, one function of its flavor: the dev build the e2e and a checkout
// load, the store zip, and the unpacked store build a release check loads. Only the store zip lacks
// the key, so the dev and unpacked builds carry the committed id, the one origin the cloud answers
// CORS for and the one id its connect page hands a credential to. wxt.config.ts hands it to WXT
// and refuses a build whose manifest.json says anything else.

import { EXTENSION_PUBLIC_KEY } from "@repo/contract/cloud/extension/extension-identity";
import { CONNECT_EXTENSION_PATH } from "@repo/contract/cloud/extension/extension-connect";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";

const EXTENSION_FLAVORS = ["dev", "store", "store-unpacked"] as const;
export type ExtensionFlavor = (typeof EXTENSION_FLAVORS)[number];

// a build's flavor is its WXT mode: `--mode store` is the store's (the zip hook in wxt.config.ts
// writes the unpacked store build from it), and every other mode, `wxt`, `wxt build` and the
// suites' included, is the dev build
export const flavorOfMode = (mode: string): ExtensionFlavor => (mode === "store" ? "store" : "dev");

// `pnpm dev:web`'s Worker, on the port docs/development.md pins
export const DEV_CLOUD_ORIGIN = "http://localhost:5174";

// the site page that may hand the extension its credential, as a match pattern: the production
// site's connect page, or the dev build's on a local Worker at any port (a pattern with no port
// matches every one), since the e2e boots each Worker on a port of its own
/** @internal */
export const connectPagePattern = (flavor: ExtensionFlavor): string =>
  flavor === "dev"
    ? `http://localhost${CONNECT_EXTENSION_PATH}`
    : `${PRODUCTION_CLOUD_ORIGIN}${CONNECT_EXTENSION_PATH}`;

const ICON_SIZES = [16, 32, 48, 128] as const;

const icons = Object.fromEntries(
  ICON_SIZES.map((size) => [String(size), `icons/icon-${size}.png`]),
);

interface ExtensionManifest {
  action: { default_icon: Record<string, string>; default_popup: string; default_title: string };
  background: { service_worker: string; type: "module" };
  commands: { _execute_action: Record<string, never> };
  description: string;
  externally_connectable: { matches: string[] };
  host_permissions?: string[];
  icons: Record<string, string>;
  key?: string;
  manifest_version: 3;
  minimum_chrome_version: string;
  name: string;
  options_ui: { open_in_tab: boolean; page: string };
  permissions: string[];
  version: string;
}

/** @internal */
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
    // the one page that may message the extension, and no other extension (no `ids`)
    externally_connectable: { matches: [connectPagePattern(flavor)] },
    icons,
    manifest_version: 3,
    // every API under `browser`, which is Chrome's own floor for it
    minimum_chrome_version: "148",
    name: "Inteligir",
    // the page with Disconnect, which a person can open again from the toolbar button's own menu
    options_ui: { open_in_tab: true, page: "welcome.html" },
    permissions: ["activeTab", "alarms", "contextMenus", "scripting", "storage"],
    version,
  };
  // the store zip carries no key: the Web Store signs the item with its own
  if (flavor !== "store") {
    manifest.key = EXTENSION_PUBLIC_KEY;
  }
  // the dev build alone may script the e2e's fixture pages on 127.0.0.1 without a click; its cloud
  // is on localhost, which no host permission names, so its calls meet CORS as a store build's do
  if (flavor === "dev") {
    manifest.host_permissions = ["http://127.0.0.1/*"];
  }
  return manifest;
};
