// the dev build of the extension in a real Chromium against a booted Worker, as a store build
// saves to the cloud: connected by the site's own connect page, a save of a page lands read, a
// second save says the page is already in the library, and a save made while the cloud cannot be reached waits in the extension and is sent by
// its alarm once the cloud answers again. The Worker is reached through a relay the scenario cuts,
// as a laptop loses its network; the page is a fixture served on loopback, which the dev build may
// script without a click, as activeTab lets a person's click do on any page.

import { createServer } from "node:http";
import type { Server } from "node:http";
import { once } from "node:events";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import {
  asLocalhost,
  connectExtension,
  extensionLaunchFlags,
  extensionPage,
  queuedSaves,
  saveFromWorker,
} from "../harness/extension-fixture";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { v1Client } from "../harness/v1-wire";

const ARTICLE_PATH = "/essays/file-over-app";
const LATER_PATH = "/essays/read-it-later";
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

const boundAddressSchema = z.object({ port: z.number().int() });

const startPages = async (): Promise<{ server: Server; origin: string }> => {
  const pages = new Map([
    [ARTICLE_PATH, pageOf(TITLE, PASSAGE)],
    [LATER_PATH, pageOf("Read it later", "A page saved while the cloud was out of reach.")],
  ]);
  const server = createServer((request, response) => {
    const page = pages.get(request.url ?? "");
    response.writeHead(page === undefined ? 404 : 200, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end(page ?? "");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = boundAddressSchema.parse(server.address());
  return { origin: `http://127.0.0.1:${String(port)}`, server };
};

export const browserExtension: Scenario = {
  description:
    "the dev extension in a real Chromium, connected by the site's connect page, saves a page read, says a second save is already saved, and queues a save the cloud could not take and sends it once the cloud answers",
  name: "browser-extension",
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);
    const link = await ctx.cloudLink(worker);
    const cloud = asLocalhost(link.origin);
    const device = await v1Client(worker, null).account.signIn({
      ...OWNER,
      deviceName: "E2E Oracle",
    });
    const { library } = v1Client(worker, device.credential);
    const pages = await startPages();
    try {
      const browser = await ctx.browser("extension", {
        launchFlags: extensionLaunchFlags(ctx),
      });

      ctx.log("signed in on the site, the connect page hands the extension its credential");
      await connectExtension(browser, cloud);

      ctx.log("a save of the page lands read");
      const article = `${pages.origin}${ARTICLE_PATH}`;
      await browser(["open", article], DEADLINE_MS);
      await browser(["tab", "new", extensionPage("welcome.html")], DEADLINE_MS);
      const first = await saveFromWorker(browser, article);
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
      await browser(["tab", "new", laterPage], DEADLINE_MS);
      await browser(["tab", "new", extensionPage("welcome.html")], DEADLINE_MS);
      const offline = await saveFromWorker(browser, laterPage);
      expectEq(offline, { kind: "queued" }, "the offline save's answer");
      const waiting = await queuedSaves(browser);
      expectEq(
        waiting.map((save) => save.url),
        [laterPage],
        "what waits in the extension",
      );

      ctx.log("the cloud answers again, and the alarm sends what waited");
      await link.restore();
      await pollUntil(
        async () => await queuedSaves(browser),
        (queued) => queued.length === 0,
        {
          deadlineMs: RESENT_DEADLINE_MS,
          describe: (queued) => `the save still waits: ${JSON.stringify(queued)}`,
          intervalMs: 2000,
        },
      );
      const after = await library.items.list({ kind: "link" });
      expect(
        after.items.some((item) => item.url === laterPage),
        `the waited save landed: ${JSON.stringify(after.items)}`,
      );
    } finally {
      pages.server.close();
    }
  },
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
};
