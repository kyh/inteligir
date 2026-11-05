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
  browserRoots,
  devLauncherPath,
  devLauncherScript,
  installNativeHost,
} from "./native-hosts";

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

// the door with a launcher that runs nothing: what the manifests name is all these cases read
const installDoor = (home: string) =>
  installNativeHost({
    homeDir: home,
    hostName: NATIVE_HOST_NAME,
    launcher: { path: devLauncherPath(home), script: "#!/bin/sh\nexit 0\n" },
    platform: "darwin",
  });

describe("the browsers' door", () => {
  it("writes a manifest only into the folders of browsers this Mac has, and Arc's into Chrome's too", () => {
    const home = makeTempDir("inteligir-native-hosts-");
    browserFolder(home, "BraveSoftware/Brave-Browser");
    browserFolder(home, "Arc/User Data");
    const result = installDoor(home);
    expect(result.failed).toEqual([]);
    expect(result.launcher).toBe(devLauncherPath(home));
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
    installDoor(home);
    expect(readFileSync(manifestAt(home, "Google/Chrome"), "utf-8")).toBe(
      `${JSON.stringify(
        {
          allowed_origins: [EXTENSION_ORIGIN],
          description: "Inteligir",
          name: NATIVE_HOST_NAME,
          path: devLauncherPath(home),
          type: "stdio",
        },
        null,
        2,
      )}\n`,
    );
  });

  it("writes a launcher at 0755 that runs node on the CLI under a scrubbed environment", () => {
    const root = makeTempDir("inteligir-native-hosts-");
    const home = path.join(root, "a 'quoted' home");
    mkdirSync(home);
    const checkout = path.join(root, "the checkout");
    mkdirSync(checkout);
    const { launcher } = installNativeHost({
      homeDir: home,
      hostName: NATIVE_HOST_NAME,
      launcher: {
        path: devLauncherPath(home),
        script: devLauncherScript({ checkout, cliBin: echoingCli(root), node: process.execPath }),
      },
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
    const handed = { HOME: home };
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
    const first = installDoor(home);
    const manifest = readFileSync(manifestAt(home, "Google/Chrome"), "utf-8");
    const second = installDoor(home);
    expect(second).toEqual(first);
    expect(readFileSync(manifestAt(home, "Google/Chrome"), "utf-8")).toBe(manifest);
  });

  it("notes a folder it cannot write and still writes every other", () => {
    const home = makeTempDir("inteligir-native-hosts-");
    browserFolder(home, "Google/Chrome");
    const edge = browserFolder(home, "Microsoft Edge");
    // a file where the manifests' folder must be
    writeFileSync(path.join(edge, "NativeMessagingHosts"), "");
    const result = installDoor(home);
    expect(result.written).toEqual([manifestAt(home, "Google/Chrome")]);
    expect(result.failed.map((failure) => failure.path)).toEqual([
      manifestAt(home, "Microsoft Edge"),
    ]);
  });

  it("writes no manifest when the launcher it would name cannot be written", () => {
    const home = makeTempDir("inteligir-native-hosts-");
    browserFolder(home, "Google/Chrome");
    // a file where the launcher's folder must be
    mkdirSync(path.dirname(path.dirname(devLauncherPath(home))), { recursive: true });
    writeFileSync(path.dirname(devLauncherPath(home)), "");
    const result = installDoor(home);
    expect(result.written).toEqual([]);
    expect(result.failed.map((failure) => failure.path)).toEqual([devLauncherPath(home)]);
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
