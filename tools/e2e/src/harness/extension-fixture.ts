// The dev build of the extension in a scenario's own browser, a profile of its own, riding the
// browser's sign-in to a booted Worker's site as a person's does: signed in on the site's own
// sign-in, which comes back to the connect page, and Connect clicked there, so the extension learns
// the site through externally_connectable and reads the session cookie the sign-in left in the
// browser's jar. The Worker is reached as `localhost`, the dev build's one cloud host and the page
// its manifest lets message it; its fixture pages are served on 127.0.0.1, which the dev build may
// script without a click.

import path from "node:path";
import { CONNECT_EXTENSION_PATH } from "@repo/contract/extension/extension-connect";
import { EXTENSION_ID } from "@repo/contract/extension/extension-identity";
import { z } from "zod";
import { clickButtonIn, parseEval, submitSiteSignIn, untilBodyHolds } from "./agent-browser";
import type { AgentBrowser } from "./agent-browser";
import { expectEq } from "./assert";

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

// signs the browser in on the site at `cloudOrigin`, as a person does, and lands on the connect
// page, which the sign-in comes back to
export const signInOnSite = async (browser: AgentBrowser, cloudOrigin: string): Promise<void> => {
  await submitSiteSignIn(browser, cloudOrigin, CONNECT_EXTENSION_PATH);
  await untilBodyHolds(browser, ["Connect the browser extension"], 60_000);
};

// signs the browser in on the site at `cloudOrigin` and connects the extension there
export const connectOnSite = async (browser: AgentBrowser, cloudOrigin: string): Promise<void> => {
  await signInOnSite(browser, cloudOrigin);
  await clickButtonIn(browser, "main", "Connect");
  await untilBodyHolds(browser, ["Connected."], 60_000);
};

// signs the browser out on the site at `cloudOrigin` through Better Auth's own sign-out, as the
// site's Sign out does, which ends the session and clears its cookie from the jar
export const signOutOnSite = async (browser: AgentBrowser, cloudOrigin: string): Promise<void> => {
  await browser(["open", `${cloudOrigin}/about`], 60_000);
  const status = parseEval(
    await browser(
      [
        "eval",
        `(async () => {
          const response = await fetch("/api/auth/sign-out", {
            body: "{}",
            headers: { "content-type": "application/json" },
            method: "POST",
          });
          return String(response.status);
        })()`,
      ],
      30_000,
    ),
    z.string(),
  );
  expectEq(status, "200", "the site's sign-out");
};

// what the extension's pages hear from its worker (apps/extension/src/messages.ts)
const extensionOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ created: z.boolean(), kind: z.literal("saved"), title: z.string() }),
  z.object({ kind: z.literal("queued"), waitsFor: z.enum(["connection", "sign-in"]) }),
  z.object({ kind: z.literal("refused"), reason: z.string() }),
  // the eval's own answer when the article's tab is not open
  z.object({ kind: z.literal("no-tab") }),
]);
export type ExtensionOutcome = z.infer<typeof extensionOutcomeSchema>;

const extensionStatusSchema = z.object({
  account: z.object({ email: z.string(), libraryUrl: z.string() }).nullable(),
  signInUrl: z.string(),
});

// from an extension page, as the popup asks: the worker reads the tab at `pageUrl` (a loopback
// page, which the dev build may script without a click) and saves it
export const saveFromWorker = async (
  browser: AgentBrowser,
  pageUrl: string,
): Promise<ExtensionOutcome> =>
  parseEval(
    await browser(
      [
        "eval",
        `(async () => {
          const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl)} });
          if (tab === undefined) return JSON.stringify({ kind: "no-tab" });
          return JSON.stringify(await chrome.runtime.sendMessage({ tabId: tab.id, type: "save" }));
        })()`,
      ],
      90_000,
    ),
    extensionOutcomeSchema,
  );

// from an extension page, as the popup and the welcome page ask: the account whose library the
// browser saves to, as the cloud reads the browser's session, or null when it is signed out
export const extensionAccount = async (browser: AgentBrowser): Promise<string | null> => {
  const status = parseEval(
    await browser(
      [
        "eval",
        `(async () => JSON.stringify(await chrome.runtime.sendMessage({ type: "status" })))()`,
      ],
      60_000,
    ),
    extensionStatusSchema,
  );
  return status.account?.email ?? null;
};

const queuedSchema = z.array(
  z.looseObject({ email: z.string(), title: z.string(), url: z.string() }),
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
