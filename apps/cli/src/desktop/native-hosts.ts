// The browsers' door. Chrome, Arc, Brave, Edge and Vivaldi each find a native-messaging host by a
// manifest in the person's own user-data folder for that browser, which names a launcher and the
// one extension allowed to start it. The app writes them at every boot, beside the agent's launcher,
// so the launcher always runs the node and the CLI this app ships, however it moved or updated. A
// manifest is written only where the browser's folder already exists, since it installs no
// browser, and Arc's goes in Chrome's folder too, which Arc reads as well as its own.

import { statSync } from "node:fs";
import path from "node:path";
import { EXTENSION_ORIGIN, NATIVE_HOST_NAME } from "@repo/contract/browser/extension-identity";
import { DEV_DATA_ROOT_DIR, PROD_DATA_DIR_NAME } from "../server/config";
import type { RuntimeMode } from "../server/config";
import { messageOf } from "../server/error-message";
import { stagedWriteFileSync } from "../server/staged-write";
import { shellQuote } from "../shell-quote";
import type { ServerTarget } from "./server-start";

const MANIFEST_DIR_NAME = "NativeMessagingHosts";
const NATIVE_HOST_DIR_NAME = "native-host";
const NATIVE_HOST_LAUNCHER_NAME = "inteligir-native-host";

export interface BrowserRoot {
  // the browser's user-data folder: there only when the browser has run for this person
  userData: string;
  // where its manifest goes
  manifestDirs: string[];
}

// under ~/Library/Application Support, each read only from its own folder
const DARWIN_BROWSERS = [
  "Google/Chrome",
  "Google/Chrome Beta",
  "Google/Chrome Dev",
  "Google/Chrome Canary",
  "Chromium",
  "Microsoft Edge",
  "Microsoft Edge Beta",
  "Microsoft Edge Dev",
  "Microsoft Edge Canary",
  "BraveSoftware/Brave-Browser",
  "BraveSoftware/Brave-Browser-Beta",
  "BraveSoftware/Brave-Browser-Nightly",
  "Vivaldi",
];
const ARC = "Arc/User Data";
// Arc starts a host it finds in Chrome's folder as well as one in its own
const ARC_ALSO_READS = "Google/Chrome";
// under ~/.config, for a checkout's own dev loop: the app is a Mac app
const LINUX_BROWSERS = ["google-chrome", "chromium"];

const ownRoot = (base: string, relative: string): BrowserRoot => ({
  manifestDirs: [path.join(base, relative, MANIFEST_DIR_NAME)],
  userData: path.join(base, relative),
});

export const browserRoots = (homeDir: string, platform: NodeJS.Platform): BrowserRoot[] => {
  if (platform === "darwin") {
    const support = path.join(homeDir, "Library", "Application Support");
    return [
      ...DARWIN_BROWSERS.map((relative) => ownRoot(support, relative)),
      {
        manifestDirs: [
          path.join(support, ARC, MANIFEST_DIR_NAME),
          path.join(support, ARC_ALSO_READS, MANIFEST_DIR_NAME),
        ],
        userData: path.join(support, ARC),
      },
    ];
  }
  if (platform === "linux") {
    const config = path.join(homeDir, ".config");
    return LINUX_BROWSERS.map((relative) => ownRoot(config, relative));
  }
  return [];
};

interface NativeHostManifest {
  allowed_origins: string[];
  description: string;
  name: string;
  path: string;
  type: "stdio";
}

const nativeHostManifest = (hostName: string, launcher: string): NativeHostManifest => ({
  allowed_origins: [EXTENSION_ORIGIN],
  description: "Inteligir",
  name: hostName,
  path: launcher,
  type: "stdio",
});

export const appLauncherPath = (homeDir: string): string =>
  path.join(homeDir, PROD_DATA_DIR_NAME, NATIVE_HOST_DIR_NAME, NATIVE_HOST_LAUNCHER_NAME);

export const devLauncherPath = (homeDir: string): string =>
  path.join(homeDir, DEV_DATA_ROOT_DIR, NATIVE_HOST_DIR_NAME, NATIVE_HOST_LAUNCHER_NAME);

// `env -i` with HOME alone: the browser's environment is whatever it was launched with, and a
// NODE_OPTIONS or a NODE_ENV in it would run code, or another mode, inside the app's own node
const appLauncherScript = (args: { node: string; cliEntry: string }): string =>
  [
    "#!/bin/sh",
    "# written by the Inteligir app at each boot: the browser's door, on the node and the CLI it ships",
    `exec /usr/bin/env -i HOME="$HOME" NODE_ENV=${shellQuote("production")} ${shellQuote(args.node)} ${shellQuote(args.cliEntry)} native-host "$@"`,
    "",
  ].join("\n");

// a checkout's server is found from the checkout it runs in, so the launcher starts there
export const devLauncherScript = (args: {
  checkout: string;
  node: string;
  cliBin: string;
}): string =>
  [
    "#!/bin/sh",
    "# written by `inteligir native-host --install`: the dev extension's door to this checkout",
    `cd ${shellQuote(args.checkout)} || exit 1`,
    `exec /usr/bin/env -i HOME="$HOME" ${shellQuote(args.node)} ${shellQuote(args.cliBin)} native-host "$@"`,
    "",
  ].join("\n");

export interface InstallNativeHostArgs {
  homeDir: string;
  platform: NodeJS.Platform;
  hostName: string;
  launcher: { path: string; script: string };
}

export interface NativeHostInstall {
  launcher: string;
  written: string[];
  failed: { path: string; reason: string }[];
}

const isDirectory = (dir: string): boolean => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

// never throws: a browser folder the app cannot write costs that browser's door, never the boot
export const installNativeHost = (args: InstallNativeHostArgs): NativeHostInstall => {
  const result: NativeHostInstall = { failed: [], launcher: args.launcher.path, written: [] };
  try {
    stagedWriteFileSync(args.launcher.path, args.launcher.script, { mode: 0o755 });
  } catch (error) {
    // a manifest naming a launcher that is not there is a door that fails on every save
    result.failed.push({ path: args.launcher.path, reason: messageOf(error) });
    return result;
  }
  const manifest = `${JSON.stringify(nativeHostManifest(args.hostName, args.launcher.path), null, 2)}\n`;
  // Chrome's folder is both Chrome's and Arc's, and written once
  const targets = new Set(
    browserRoots(args.homeDir, args.platform)
      .filter((root) => isDirectory(root.userData))
      .flatMap((root) => root.manifestDirs.map((dir) => path.join(dir, `${args.hostName}.json`))),
  );
  for (const target of targets) {
    try {
      stagedWriteFileSync(target, manifest);
      result.written.push(target);
    } catch (error) {
      result.failed.push({ path: target, reason: messageOf(error) });
    }
  }
  return result;
};

export interface AppNativeHostArgs {
  homeDir: string;
  platform: NodeJS.Platform;
  node: string;
  cliEntry: string;
}

export const installAppNativeHost = (args: AppNativeHostArgs): NativeHostInstall =>
  installNativeHost({
    homeDir: args.homeDir,
    hostName: NATIVE_HOST_NAME,
    launcher: { path: appLauncherPath(args.homeDir), script: appLauncherScript(args) },
    platform: args.platform,
  });

export interface NativeHostPlanArgs {
  mode: RuntimeMode;
  target: Pick<ServerTarget, "dataDirSource">;
  execPath: string;
}

// only the packaged app, on a data dir the root derives, from where it was installed. The shell
// pins every child's vault, so a selector rewritten since cannot move it, and never its data dir,
// so the vault pin says nothing here; a data dir an env pins (a harness, the smoke's first launch)
// holds a server the door, which finds one through the root, would never find. An app macOS
// translocated runs from a read-only copy that is gone once it quits, so a launcher naming its node
// would fail every save after
export const installsNativeHost = (args: NativeHostPlanArgs): boolean =>
  args.mode === "prod" &&
  args.target.dataDirSource !== "env" &&
  !args.execPath.includes("/AppTranslocation/");
