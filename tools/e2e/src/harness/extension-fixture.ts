// The dev build of the extension in a scenario's own browser, a profile of its own, connected to a
// booted Worker's account as a person connects it: signed in on the site's own sign-in, which comes
// back to the connect page, and Connect clicked there, so the site hands the extension its
// credential through externally_connectable. The Worker is reached as `localhost`, the host the dev
// build's manifest lets message it, and one no host permission names, so the extension's calls
// meet CORS as a store build's do; its fixture pages are served on 127.0.0.1, which the dev build
// may script without a click.

import path from "node:path";
import { CONNECT_EXTENSION_PATH } from "@repo/contract/cloud/extension/extension-connect";
import { EXTENSION_ID } from "@repo/contract/cloud/extension/extension-identity";
import { z } from "zod";
import { clickButtonIn, parseEval, untilBodyHolds } from "./agent-browser";
import type { AgentBrowser } from "./agent-browser";
import { OWNER } from "./cloud-account";

// what the scenario's browser launches with on every call: the profile and the dev build
export const extensionLaunchFlags = (args: {
  readonly repoRoot: string;
  readonly scratchDir: string;
}): readonly string[] => [
  "--profile",
  path.join(args.scratchDir, "browser-profile"),
  "--extension",
  // WXT's own output for the dev flavor `wxt build` writes
  path.join(args.repoRoot, "apps", "extension", ".output", "chrome-mv3"),
];

// an extension page's address, from which a scenario asks the service worker as the popup does
export const extensionPage = (page: string): string => `chrome-extension://${EXTENSION_ID}/${page}`;

// a loopback origin as the dev build's manifest names it
export const asLocalhost = (origin: string): string => {
  const url = new URL(origin);
  url.hostname = "localhost";
  return url.origin;
};

// signs the browser in on the site at `cloudOrigin` and connects the extension there
export const connectExtension = async (
  browser: AgentBrowser,
  cloudOrigin: string,
): Promise<void> => {
  const next = new URLSearchParams({ next: CONNECT_EXTENSION_PATH }).toString();
  await browser(["open", `${cloudOrigin}/app/sign-in?${next}`], 60_000);
  await browser(["wait", "#email"], 60_000);
  await browser(["fill", "#email", OWNER.email]);
  await browser(["fill", "#password", OWNER.password]);
  await browser(["click", 'button[type="submit"]']);
  await untilBodyHolds(browser, ["Connect the browser extension"], 60_000);
  await clickButtonIn(browser, "main", "Connect");
  await untilBodyHolds(browser, ["Connected."], 60_000);
};

// what the extension's pages hear from its worker (apps/extension/src/messages.ts)
const extensionOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ created: z.boolean(), kind: z.literal("saved"), title: z.string() }),
  z.object({ kind: z.literal("queued") }),
  z.object({ kind: z.literal("refused"), reason: z.string() }),
  // the eval's own answer when the article's tab is not open
  z.object({ kind: z.literal("no-tab") }),
]);
export type ExtensionOutcome = z.infer<typeof extensionOutcomeSchema>;

// from an extension page, as the popup asks: the worker reads the tab at `pageUrl` (a loopback
// page, which the dev build may script without a click) and saves it. `select` first selects the
// element of that id in the tab, as a person would before saving
export const saveFromWorker = async (
  browser: AgentBrowser,
  pageUrl: string,
  select: string | null,
): Promise<ExtensionOutcome> =>
  parseEval(
    await browser(
      [
        "eval",
        `(async () => {
          const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
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

const queuedSchema = z.array(
  z.looseObject({ selection: z.string().nullable(), title: z.string(), url: z.string() }),
);

// the saves the worker keeps waiting, as its storage holds them, from an extension page
export const queuedSaves = async (browser: AgentBrowser) =>
  parseEval(
    await browser(
      [
        "eval",
        `(async () => {
          const stored = await chrome.storage.local.get(null);
          return JSON.stringify(
            Object.entries(stored).filter(([key]) => key.startsWith("save:")).map(([, save]) => save),
          );
        })()`,
      ],
      30_000,
    ),
    queuedSchema,
  );
