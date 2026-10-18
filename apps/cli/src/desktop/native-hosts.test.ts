import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEV_NATIVE_HOST_NAME,
  EXTENSION_ORIGIN,
  NATIVE_HOST_NAME,
} from "@repo/contract/browser/extension-identity";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../server/test-support/boot-app";
import {
  appLauncherPath,
  browserRoots,
  devLauncherScript,
  installAppNativeHost,
  installNativeHost,
  installsNativeHost,
} from "./native-hosts";
import { resolveServerTarget } from "./server-start";

const SUPPORT = path.join("Library", "Application Support");

// a CLI that prints what it was handed and the environment it ran in, standing in for the bundle
const echoingCli = (dir: string): string => {
  const entry = path.join(dir, "it's the cli.js");
  writeFileSync(
    entry,
    "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), env: process.env }));\n",
  );
  return entry;
};

const browserFolder = (home: string, relative: string): string => {
  const dir = path.join(home, SUPPORT, relative);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const manifestAt = (home: string, relative: string, host = NATIVE_HOST_NAME): string =>
  path.join(home, SUPPORT, relative, "NativeMessagingHosts", `${host}.json`);

describe("the browsers' door the app writes", () => {
  it("writes a manifest only into the folders of browsers this Mac has, and Arc's into Chrome's too", () => {
    const home = makeTempDir("inteligir-native-hosts-");
    browserFolder(home, "BraveSoftware/Brave-Browser");
    browserFolder(home, "Arc/User Data");
    const result = installAppNativeHost({
      cliEntry: "/Applications/Inteligir.app/Contents/Resources/server/dist/index.js",
      homeDir: home,
      node: "/Applications/Inteligir.app/Contents/MacOS/node",
      platform: "darwin",
    });
    expect(result.failed).toEqual([]);
    expect(result.launcher).toBe(appLauncherPath(home));
    expect(result.written.toSorted()).toEqual(
      [
        manifestAt(home, "Arc/User Data"),
        manifestAt(home, "BraveSoftware/Brave-Browser"),
        manifestAt(home, "Google/Chrome"),
      ].toSorted(),
    );
    expect(existsSync(path.join(home, SUPPORT, "Microsoft Edge"))).toBe(false);
    expect(existsSync(path.join(home, SUPPORT, "Vivaldi"))).toBe(false);
  });

  it("writes the exact manifest Chrome reads: the host's name, its launcher and the extension alone", () => {
    const home = makeTempDir("inteligir-native-hosts-");
    browserFolder(home, "Google/Chrome");
    installAppNativeHost({ cliEntry: "/e.js", homeDir: home, node: "/node", platform: "darwin" });
    expect(readFileSync(manifestAt(home, "Google/Chrome"), "utf-8")).toBe(
      `${JSON.stringify(
        {
          allowed_origins: [EXTENSION_ORIGIN],
          description: "Inteligir",
          name: NATIVE_HOST_NAME,
          path: appLauncherPath(home),
          type: "stdio",
        },
        null,
        2,
      )}\n`,
    );
  });

  it("writes a launcher at 0755 that runs the app's node on its CLI under a scrubbed environment", () => {
    const root = makeTempDir("inteligir-native-hosts-");
    const home = path.join(root, "a 'quoted' home");
    mkdirSync(home);
    const cliEntry = echoingCli(root);
    const { launcher } = installAppNativeHost({
      cliEntry,
      homeDir: home,
      node: process.execPath,
      platform: "darwin",
    });
    expect(statSync(launcher).mode.toString(8).slice(-3)).toBe("755");
    const script = readFileSync(launcher, "utf-8");
    expect(script).toContain('exec /usr/bin/env -i HOME="$HOME"');
    expect(script).toContain(`'${process.execPath}'`);
    const printed = execFileSync(launcher, [EXTENSION_ORIGIN], {
      encoding: "utf-8",
      env: {
        HOME: home,
        NODE_ENV: "development",
        NODE_OPTIONS: "--require /evil.js",
        PATH: "/bin",
      },
    });
    const ran: unknown = JSON.parse(printed);
    const handed = { HOME: home, NODE_ENV: "production" };
    expect(ran).toEqual({
      args: ["native-host", EXTENSION_ORIGIN],
      // exactly what the launcher handed, or that and the one variable macOS adds to every
      // process: it sets __CF_USER_TEXT_ENCODING inside the process itself, past any `env -i`
      env: expect.toBeOneOf([handed, { ...handed, __CF_USER_TEXT_ENCODING: expect.any(String) }]),
    });
  });

  it("is the same door however often it is written", () => {
    const home = makeTempDir("inteligir-native-hosts-");
    browserFolder(home, "Google/Chrome");
    const args = { cliEntry: "/e.js", homeDir: home, node: "/node", platform: "darwin" } as const;
    const first = installAppNativeHost(args);
    const manifest = readFileSync(manifestAt(home, "Google/Chrome"), "utf-8");
    const second = installAppNativeHost(args);
    expect(second).toEqual(first);
    expect(readFileSync(manifestAt(home, "Google/Chrome"), "utf-8")).toBe(manifest);
  });

  it("notes a folder it cannot write and still writes every other", () => {
    const home = makeTempDir("inteligir-native-hosts-");
    browserFolder(home, "Google/Chrome");
    const edge = browserFolder(home, "Microsoft Edge");
    // a file where the manifests' folder must be
    writeFileSync(path.join(edge, "NativeMessagingHosts"), "");
    const result = installAppNativeHost({
      cliEntry: "/e.js",
      homeDir: home,
      node: "/node",
      platform: "darwin",
    });
    expect(result.written).toEqual([manifestAt(home, "Google/Chrome")]);
    expect(result.failed.map((failure) => failure.path)).toEqual([
      manifestAt(home, "Microsoft Edge"),
    ]);
  });

  it("writes no manifest when the launcher it would name cannot be written", () => {
    const home = makeTempDir("inteligir-native-hosts-");
    browserFolder(home, "Google/Chrome");
    // a file where the app's data folder must be
    writeFileSync(path.join(home, ".inteligir"), "");
    const result = installAppNativeHost({
      cliEntry: "/e.js",
      homeDir: home,
      node: "/node",
      platform: "darwin",
    });
    expect(result.written).toEqual([]);
    expect(result.failed.map((failure) => failure.path)).toEqual([appLauncherPath(home)]);
  });

  it("knows every Chromium browser's folder on a Mac, and a checkout's two on linux", () => {
    const darwin = browserRoots("/Users/me", "darwin").map((root) => root.userData);
    expect(darwin).toContain("/Users/me/Library/Application Support/Google/Chrome Canary");
    expect(darwin).toContain("/Users/me/Library/Application Support/Microsoft Edge Dev");
    expect(darwin).toContain(
      "/Users/me/Library/Application Support/BraveSoftware/Brave-Browser-Nightly",
    );
    expect(darwin).toContain("/Users/me/Library/Application Support/Vivaldi");
    expect(darwin).toContain("/Users/me/Library/Application Support/Chromium");
    expect(darwin).toHaveLength(14);
    expect(browserRoots("/home/me", "linux").map((root) => root.manifestDirs)).toEqual([
      ["/home/me/.config/google-chrome/NativeMessagingHosts"],
      ["/home/me/.config/chromium/NativeMessagingHosts"],
    ]);
    expect(browserRoots("C:\\Users\\me", "win32")).toEqual([]);
  });

  it("writes a checkout's dev door under the dev host's name, starting in that checkout", () => {
    const root = makeTempDir("inteligir-native-hosts-");
    const home = path.join(root, "home");
    mkdirSync(path.join(home, ".config", "chromium"), { recursive: true });
    const checkout = path.join(root, "the checkout");
    mkdirSync(checkout);
    const launcher = path.join(home, "launcher");
    const result = installNativeHost({
      homeDir: home,
      hostName: DEV_NATIVE_HOST_NAME,
      launcher: {
        path: launcher,
        script: devLauncherScript({ checkout, cliBin: echoingCli(root), node: process.execPath }),
      },
      platform: "linux",
    });
    expect(result.written).toEqual([
      path.join(
        home,
        ".config",
        "chromium",
        "NativeMessagingHosts",
        `${DEV_NATIVE_HOST_NAME}.json`,
      ),
    ]);
    const printed = execFileSync(launcher, [EXTENSION_ORIGIN], {
      encoding: "utf-8",
      env: { HOME: home },
    });
    expect(JSON.parse(printed)).toMatchObject({ args: ["native-host", EXTENSION_ORIGIN] });
  });
});

describe("whether a launch writes the door", () => {
  const unpinned = { dataDirSource: "default", vaultDirSource: "default" } as const;
  const selected = { dataDirSource: "default", vaultDirSource: "managed-config" } as const;
  // the shell's every child: its vault pinned so a selector rewritten since cannot move it
  const shellChild = { dataDirSource: "default", vaultDirSource: "env" } as const;
  // a harness, and the smoke's first launch
  const dataDirPinned = { dataDirSource: "env", vaultDirSource: "default" } as const;
  const bothPinned = { dataDirSource: "env", vaultDirSource: "env" } as const;
  const app = "/Applications/Inteligir.app/Contents/MacOS/node";

  it("writes it from the packaged app, on a data dir the root derives, where it was installed", () => {
    expect(installsNativeHost({ execPath: app, mode: "prod", target: unpinned })).toBe(true);
    expect(installsNativeHost({ execPath: app, mode: "prod", target: selected })).toBe(true);
  });

  it("writes it under the shell, which pins every child's vault but never its data dir", () => {
    expect(installsNativeHost({ execPath: app, mode: "prod", target: shellChild })).toBe(true);
    // the env the shell's server_command hands its child, resolved as desktop-serve does
    const homeDir = makeTempDir("inteligir-door-home-");
    const vaultDir = path.join(homeDir, "Inteligir");
    const childOf = (env: NodeJS.ProcessEnv) => {
      const resolved = resolveServerTarget({ env, homeDir });
      if (resolved.kind !== "resolved") {
        throw new Error(resolved.error);
      }
      return resolved.target;
    };
    const shellEnv = { INTELIGIR_VAULT_DIR: vaultDir, NODE_ENV: "production" };
    expect(installsNativeHost({ execPath: app, mode: "prod", target: childOf(shellEnv) })).toBe(
      true,
    );
    expect(
      installsNativeHost({
        execPath: app,
        mode: "prod",
        target: childOf({ ...shellEnv, INTELIGIR_DATA_DIR: path.join(homeDir, "pinned") }),
      }),
    ).toBe(false);
  });

  it("never from a checkout, a data dir an env pins, or an app macOS translocated", () => {
    expect(installsNativeHost({ execPath: app, mode: "dev", target: shellChild })).toBe(false);
    expect(installsNativeHost({ execPath: app, mode: "prod", target: dataDirPinned })).toBe(false);
    expect(installsNativeHost({ execPath: app, mode: "prod", target: bothPinned })).toBe(false);
    expect(
      installsNativeHost({
        execPath:
          "/private/var/folders/x/T/AppTranslocation/1234/d/Inteligir.app/Contents/MacOS/node",
        mode: "prod",
        target: shellChild,
      }),
    ).toBe(false);
  });
});
