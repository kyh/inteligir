// an extension save, end to end: the dev build in a real Chromium reads the page as the person sees
// it and saves it read through `/v1`, so the cloud never asks for it. The page writes its passage
// with its own script after it loads, so the passage is in the page the browser shows and in no markup the server ever sent: a
// save that fetched the page could not hold it. The page is served on loopback, which the dev build
// may script without a click; the cloud reads nothing from such an address, so its text can only
// be the one the extension read.

import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { z } from "zod";
import { untilBodyHolds } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import {
  asLocalhost,
  connectExtension,
  extensionLaunchFlags,
  extensionPage,
  saveFromWorker,
  sessionBearerOf,
} from "../harness/extension-fixture";
import type { Scenario } from "../harness/scenario";
import { v1Client } from "../harness/v1-wire";

const ARTICLE_PATH = "/essays/file-over-app";
const TITLE = "File over app";
const SERVED =
  "If you want to create digital artifacts that last, they must be files you can control.";
const CLOSING = "The file is the one thing every app agrees on, so it is the thing to keep.";
// written by the page's own script once it has loaded: never in the markup served
const PASSAGE = "Apps are ephemeral, and the files they write outlast every one of them.";
const DEADLINE_MS = 60_000;

const ARTICLE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  `<title>${TITLE}</title>`,
  "</head><body><article>",
  `<h1>${TITLE}</h1>`,
  `<p>${SERVED}</p>`,
  '<div id="later"></div>',
  `<p>${CLOSING}</p>`,
  "</article>",
  "<script>",
  "  const passage = document.createElement('p');",
  "  passage.id = 'passage';",
  `  passage.textContent = ${JSON.stringify(PASSAGE)};`,
  "  document.getElementById('later').replaceWith(passage);",
  "</script>",
  "</body></html>",
].join("\n");

const boundAddressSchema = z.object({ port: z.number().int() });

// counts what asks for the article, so the scenario can say who read it
const startArticleServer = async (): Promise<{
  server: Server;
  url: string;
  articleRequests: () => number;
}> => {
  let articleRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === ARTICLE_PATH) {
      articleRequests += 1;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(ARTICLE);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = boundAddressSchema.parse(server.address());
  return {
    articleRequests: () => articleRequests,
    server,
    url: `http://127.0.0.1:${String(port)}${ARTICLE_PATH}`,
  };
};

export const extensionIntegrated: Scenario = {
  description:
    "an extension save of a fixture page takes its text from the page the browser shows, and the cloud never asks for the page",
  name: "extension-integrated",
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    const owner = await signUp(worker.origin);
    // the account's own session, called through the extension's door
    const { library } = v1Client(worker, sessionBearerOf(owner.cookie));
    const article = await startArticleServer();
    try {
      const browser = await ctx.browser("extension-integrated", {
        launchFlags: extensionLaunchFlags(ctx),
      });
      await connectExtension(browser, asLocalhost(worker.origin));

      ctx.log("the page loads and its own script writes the passage into the article");
      await browser(["open", article.url], DEADLINE_MS);
      await untilBodyHolds(browser, [PASSAGE], DEADLINE_MS);
      expectEq(article.articleRequests(), 1, "requests for the article before the save");
      await browser(["tab", "new", extensionPage("welcome.html")], DEADLINE_MS);

      ctx.log("a save makes the item from the page the extension read");
      const saved = await saveFromWorker(browser, article.url);
      expectEq(saved, { created: true, kind: "saved", title: TITLE }, "the save's answer");

      ctx.log("the item holds the page as the browser showed it, the passage in the article");
      const { items } = await library.items.list({ kind: "link" });
      const item = items.find((listed) => listed.url === article.url);
      expect(
        item !== undefined,
        `the cell holds no item at the page's address: ${JSON.stringify(items)}`,
      );
      const read = await library.items.read({ id: item.id });
      expectEq(read.fields.fetchState, "filled", "the item was read at the save");
      expectEq(read.fields.fetchError, null, "the reading's failure");
      const { markdown } = read.view;
      for (const words of [SERVED, PASSAGE, CLOSING]) {
        expect(markdown.includes(words), `the article holds "${words}":\n${markdown}`);
      }
      expectEq(
        article.articleRequests(),
        1,
        "requests for the article after the save: neither the extension nor the cloud fetched it",
      );
    } finally {
      article.server.close();
    }
  },
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
};
