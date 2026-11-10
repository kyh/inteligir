// the dev build of the extension in a real Chromium against a booted Worker, as a store build
// saves to the cloud: it rides the browser's sign-in to the site, which the connect page points it
// at; a save of a page lands read, a second save says the page is already in the library, and a
// save made while the cloud cannot be reached waits in the extension and is sent by its alarm once
// the cloud answers again. A session the account signs out from another device, and a sign-out on
// the site, each leave the extension signed out with what it saves waiting, sent once the browser
// signs in again. The Worker is reached through a relay the scenario cuts, as a laptop loses its
// network; the page is a fixture served on loopback, which the dev build may script without a
// click, as activeTab lets a person's click do on any page.

import { createServer } from "node:http";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import {
  asLocalhost,
  connectOnSite,
  extensionAccount,
  extensionLaunchFlags,
  extensionPage,
  queuedSaves,
  saveFromWorker,
  signInOnSite,
  signOutOnSite,
} from "../harness/extension-fixture";
import { pollUntil } from "../harness/poll";
import { listenOnLoopback } from "../harness/ports";
import type { LoopbackListener } from "../harness/ports";
import type { Scenario } from "../harness/scenario";
import { asExtension, v1Client } from "../harness/v1-wire";

const ARTICLE_PATH = "/essays/file-over-app";
const LATER_PATH = "/essays/read-it-later";
const REVOKED_PATH = "/essays/signed-out-elsewhere";
const SIGNED_OUT_PATH = "/essays/signed-out-here";
const TITLE = "File over app";
const PASSAGE = "Apps are ephemeral, and the files they write outlast every one of them.";
const DEADLINE_MS = 60_000;
// the alarm that sends what waited goes every 30 s, so a save sent again lands within two
const RESENT_DEADLINE_MS = 90_000;

const pageOf = (title: string, passage: string): string =>
  [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    "</head><body><article>",
    `<h1>${title}</h1>`,
    "<p>If you want to create digital artifacts that last, they must be files you can control.</p>",
    `<p id="passage">${passage}</p>`,
    "<p>The file is the one thing every app agrees on, so it is the thing to keep.</p>",
    "</article></body></html>",
  ].join("\n");

const startPages = async (): Promise<LoopbackListener> => {
  const pages = new Map([
    [ARTICLE_PATH, pageOf(TITLE, PASSAGE)],
    [LATER_PATH, pageOf("Read it later", "A page saved while the cloud was out of reach.")],
    [
      REVOKED_PATH,
      pageOf("Signed out elsewhere", "A page saved after another device signed this browser out."),
    ],
    [
      SIGNED_OUT_PATH,
      pageOf("Signed out here", "A page saved after the site signed this browser out."),
    ],
  ]);
  const server = createServer((request, response) => {
    const page = pages.get(request.url ?? "");
    response.writeHead(page === undefined ? 404 : 200, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end(page ?? "");
  });
  return await listenOnLoopback(server);
};

// the page open in a tab, then an extension page in front, from which the save is asked
const saveInTab = async (browser: AgentBrowser, page: string) => {
  await browser(["tab", "new", page], DEADLINE_MS);
  await browser(["tab", "new", extensionPage("welcome.html")], DEADLINE_MS);
  return await saveFromWorker(browser, page);
};

// what the extension keeps waiting has all gone, within the alarm's two turns
const untilNothingWaits = async (browser: AgentBrowser, deadlineMs: number): Promise<void> => {
  await pollUntil(
    async () => await queuedSaves(browser),
    (queued) => queued.length === 0,
    {
      deadlineMs,
      describe: (queued) => `the save still waits: ${JSON.stringify(queued)}`,
      intervalMs: 2000,
    },
  );
};

export const browserExtension: Scenario = {
  description:
    "the dev extension in a real Chromium rides the browser's sign-in: it saves a page read, says a second save is already saved, queues a save the cloud could not take and sends it once the cloud answers, and a session ended elsewhere or a sign-out on the site leaves it signed out, its saves waiting until the browser signs in again",
  name: "browser-extension",
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    const owner = await signUp(worker.origin);
    const link = await ctx.cloudLink(worker);
    const cloud = asLocalhost(link.origin);
    // the account's own session, called through the extension's door, so the oracle needs no
    // credential of its own
    const { account, library } = v1Client(worker, asExtension(owner.cookie));
    const landed = async (url: string): Promise<boolean> => {
      const { items } = await library.items.list({ kind: "link" });
      return items.some((item) => item.url === url);
    };
    const pages = await startPages();
    try {
      const browser = await ctx.browser("extension", {
        launchFlags: extensionLaunchFlags(ctx),
      });

      ctx.log("signed in on the site, the connect page points the extension at the account");
      await connectOnSite(browser, cloud);
      await browser(["tab", "new", extensionPage("welcome.html")], DEADLINE_MS);
      expectEq(
        await extensionAccount(browser),
        OWNER.email,
        "the account the extension says it saves to",
      );

      ctx.log("a save of the page lands read");
      const article = `${pages.origin}${ARTICLE_PATH}`;
      const first = await saveInTab(browser, article);
      expectEq(first, { created: true, kind: "saved", title: TITLE }, "the first save's answer");
      const { items } = await library.items.list({ kind: "link" });
      const saved = items.find((item) => item.url === article);
      expect(
        saved !== undefined,
        `the cell holds no item at the page's address: ${JSON.stringify(items)}`,
      );
      const read = await library.items.read({ id: saved.id });
      expectEq(read.fields.fetchState, "filled", "the saved page's reading");
      expect(
        read.view.markdown.includes(PASSAGE),
        `the article holds the passage:\n${read.view.markdown}`,
      );

      ctx.log("a second save of the same page says it is already in the library");
      const second = await saveFromWorker(browser, article);
      expectEq(second, { created: false, kind: "saved", title: TITLE }, "the second save's answer");

      ctx.log("with the cloud out of reach, a save waits in the extension as its address alone");
      await link.cut();
      const laterPage = `${pages.origin}${LATER_PATH}`;
      const offline = await saveInTab(browser, laterPage);
      expectEq(offline, { kind: "queued", waitsFor: "connection" }, "the offline save's answer");
      const waiting = await queuedSaves(browser);
      expectEq(
        waiting.map((save) => save.url),
        [laterPage],
        "what waits in the extension",
      );

      ctx.log("the cloud answers again, and the alarm sends what waited");
      await link.restore();
      await untilNothingWaits(browser, RESENT_DEADLINE_MS);
      expect(await landed(laterPage), "the waited save landed");

      ctx.log("the account signs this browser out from another device, and a save waits for it");
      const { devices } = await account.devices.list();
      const others = devices.filter((device) => !device.current);
      expect(others.length > 0, `the browser's session is listed: ${JSON.stringify(devices)}`);
      for (const other of others) {
        await account.devices.revoke({ id: other.id });
      }
      const revokedPage = `${pages.origin}${REVOKED_PATH}`;
      const revoked = await saveInTab(browser, revokedPage);
      expectEq(revoked, { kind: "queued", waitsFor: "sign-in" }, "a save after the session ended");
      const waitingForSignIn = await queuedSaves(browser);
      expectEq(
        waitingForSignIn.map((save) => [save.email, save.url]),
        [[OWNER.email, revokedPage]],
        "what waits for the sign-in",
      );
      expectEq(await extensionAccount(browser), null, "the extension's account");

      ctx.log("signed in and connected again, the save that waited goes");
      await connectOnSite(browser, cloud);
      await browser(["tab", "new", extensionPage("welcome.html")], DEADLINE_MS);
      await untilNothingWaits(browser, DEADLINE_MS);
      expect(await landed(revokedPage), "the save made signed out landed");

      ctx.log("a sign-out on the site signs the extension out, and a save waits unread");
      await signOutOnSite(browser, cloud);
      await browser(["tab", "new", extensionPage("welcome.html")], DEADLINE_MS);
      expectEq(await extensionAccount(browser), null, "the extension's account");
      const signedOutPage = `${pages.origin}${SIGNED_OUT_PATH}`;
      const signedOut = await saveInTab(browser, signedOutPage);
      expectEq(signedOut, { kind: "queued", waitsFor: "sign-in" }, "a save after the sign-out");

      ctx.log("signing in on the site again sends it by the alarm, with no connect asked");
      await signInOnSite(browser, cloud);
      await browser(["tab", "new", extensionPage("welcome.html")], DEADLINE_MS);
      await untilNothingWaits(browser, RESENT_DEADLINE_MS);
      expect(await landed(signedOutPage), "the save made after the sign-out landed");
      expectEq(
        await extensionAccount(browser),
        OWNER.email,
        "the account the extension saves to again",
      );
    } finally {
      await pages.close();
    }
  },
  // it waits on the alarm three times, past the two minutes a scenario's own work is given
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS + 2 * RESENT_DEADLINE_MS,
};
