import { EXTENSION_PUBLIC_KEY } from "@repo/contract/extension/extension-identity";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/origin";

const EXTENSION_FLAVORS = ["dev", "store", "store-unpacked"] as const;

export type ExtensionFlavor = (typeof EXTENSION_FLAVORS)[number];

export const flavorOfMode = (mode: string) =>
  (mode === "store" ? "store" : "dev") satisfies ExtensionFlavor;

export const DEV_CLOUD_ORIGIN = "http://localhost:5174";

const cloudHostPattern = (flavor: ExtensionFlavor) =>
  flavor === "dev" ? "http://localhost/*" : `${PRODUCTION_CLOUD_ORIGIN}/*`;

const ICON_SIZES = [16, 32, 48, 128] as const;

const icons = Object.fromEntries(
  ICON_SIZES.map((size) => [String(size), `icons/icon-${size}.png`]),
);

interface ExtensionManifest {
  action: { default_icon: Record<string, string>; default_popup: string; default_title: string };
  background: { service_worker: string; type: "module" };
  commands: { _execute_action: Record<string, never> };
  description: string;
  host_permissions: string[];
  icons: Record<string, string>;
  key?: string;
  manifest_version: 3;
  minimum_chrome_version: string;
  name: string;
  options_ui: { open_in_tab: boolean; page: string };
  permissions: string[];
  version: string;
}

export const extensionManifest = (flavor: ExtensionFlavor, version: string) => {
  const manifest: ExtensionManifest = {
    action: {
      default_icon: icons,
      default_popup: "popup.html",
      default_title: "Save to Inteligir",
    },
    background: { service_worker: "background.js", type: "module" },
    commands: { _execute_action: {} },
    description: "Save the page you're on to your Inteligir library.",
    host_permissions:
      flavor === "dev"
        ? ["http://127.0.0.1/*", cloudHostPattern(flavor)]
        : [cloudHostPattern(flavor)],
    icons,
    manifest_version: 3,
    minimum_chrome_version: "148",
    name: "Inteligir",
    options_ui: { open_in_tab: true, page: "welcome.html" },
    permissions: ["activeTab", "alarms", "contextMenus", "cookies", "scripting", "storage"],
    version,
  };

  if (flavor !== "store") {
    manifest.key = EXTENSION_PUBLIC_KEY;
  }

  return manifest;
};
