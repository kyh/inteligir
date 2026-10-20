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
import { z } from "zod";
import { parseEval } from "./agent-browser";
import type { AgentBrowser } from "./agent-browser";

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
  // the built bundle, as the app's launcher runs it: what ships, and no loader to start per save.
  // A dev host, never the packaged one: a packaged host with no server opens the app installed on
  // this Mac and waits 30 s for it, so a run on the owner's Mac would start their own app on their
  // own library, and a step that stopped the server would test another path than CI's (whose
  // openApp answers false); the open-and-wait path is run-native-host.test.ts's
  const cliEntry = path.join(args.repoRoot, "apps", "cli", "dist", "index.js");
  await mkdir(manifestDir, { recursive: true });
  await mkdir(path.dirname(launcher), { recursive: true });
  await writeFile(
    launcher,
    [
      "#!/bin/sh",
      `exec /usr/bin/env -i HOME="$HOME" INTELIGIR_DATA_DIR=${quote(args.dataDir)} ${quote(process.execPath)} ${quote(cliEntry)} native-host "$@"`,
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
      // WXT's own output for the dev flavor `wxt build` writes
      path.join(args.repoRoot, "apps", "extension", ".output", "chrome-mv3"),
    ],
  };
};

// what the extension's pages hear from its worker (apps/extension/src/messages.ts)
const extensionOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ created: z.boolean(), kind: z.literal("saved"), path: z.string(), title: z.string() }),
  z.object({ appVersion: z.string(), kind: z.literal("hello"), library: z.string() }),
  z.object({ kind: z.literal("opened") }),
  z.object({ detail: z.string(), kind: z.literal("refused"), reason: z.string() }),
  // the eval's own answer when the article's tab is not open
  z.object({ kind: z.literal("no-tab") }),
]);
export type ExtensionOutcome = z.infer<typeof extensionOutcomeSchema>;

// from an extension page, as the popup asks: the worker captures the page's tab (the one loopback
// tab, which the dev build may script without a click) and asks the host. `select` first selects
// the element of that id in the tab, as a person would before saving
export const saveFromWorker = async (
  browser: AgentBrowser,
  select: string | null,
): Promise<ExtensionOutcome> =>
  parseEval(
    await browser(
      [
        "eval",
        `(async () => {
          const [tab] = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
          if (tab === undefined) return JSON.stringify({ kind: "no-tab" });
          const select = ${JSON.stringify(select)};
          if (select !== null) {
            await chrome.scripting.executeScript({
              args: [select],
              func: (id) => {
                const node = document.getElementById(id);
                if (node !== null) window.getSelection()?.selectAllChildren(node);
              },
              target: { tabId: tab.id },
            });
          }
          return JSON.stringify(await chrome.runtime.sendMessage({ tabId: tab.id, type: "save" }));
        })()`,
      ],
      90_000,
    ),
    extensionOutcomeSchema,
  );
