// the browser's door for a scenario's own browser: the dev build of the extension in a profile of
// its own, whose NativeMessagingHosts folder names a launcher that runs this checkout's built CLI
// as the native host against one instance's data dir. Chrome reads a user's host manifests from
// the user-data folder it was started with, so nothing is written outside the scratch dir.

import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEV_NATIVE_HOST_NAME,
  EXTENSION_ID,
  EXTENSION_ORIGIN,
} from "@repo/contract/browser/extension-identity";

export interface NativeHostFixture {
  // what the scenario's browser launches with on every call: the profile and the dev build
  launchFlags: readonly string[];
  // an extension page's address, from which a scenario asks the service worker as the popup does
  extensionPage: (page: string) => string;
}

export interface NativeHostFixtureArgs {
  repoRoot: string;
  scratchDir: string;
  // the instance the door reaches, pinned as the packaged app's launcher never pins one
  dataDir: string;
}

const quote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

export const installNativeHostFixture = async (
  args: NativeHostFixtureArgs,
): Promise<NativeHostFixture> => {
  const profileDir = path.join(args.scratchDir, "browser-profile");
  const manifestDir = path.join(profileDir, "NativeMessagingHosts");
  const launcher = path.join(args.scratchDir, "native-host", "inteligir-native-host");
  // the built bundle, as the app's launcher runs it: what ships, and no loader to start per save
  const cliEntry = path.join(args.repoRoot, "apps", "cli", "dist", "index.js");
  await mkdir(manifestDir, { recursive: true });
  await mkdir(path.dirname(launcher), { recursive: true });
  await writeFile(
    launcher,
    [
      "#!/bin/sh",
      `exec /usr/bin/env -i HOME="$HOME" NODE_ENV='production' INTELIGIR_DATA_DIR=${quote(args.dataDir)} ${quote(process.execPath)} ${quote(cliEntry)} native-host "$@"`,
      "",
    ].join("\n"),
  );
  await chmod(launcher, 0o755);
  await writeFile(
    path.join(manifestDir, `${DEV_NATIVE_HOST_NAME}.json`),
    `${JSON.stringify(
      {
        allowed_origins: [EXTENSION_ORIGIN],
        description: "Inteligir",
        name: DEV_NATIVE_HOST_NAME,
        path: launcher,
        type: "stdio",
      },
      null,
      2,
    )}\n`,
  );
  return {
    extensionPage: (page) => `chrome-extension://${EXTENSION_ID}/${page}`,
    launchFlags: [
      "--profile",
      profileDir,
      "--extension",
      path.join(args.repoRoot, "apps", "extension", "dist"),
    ],
  };
};
