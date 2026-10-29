// the dev build of the extension in a real Chromium, reaching a running app through its native
// host exactly as a store build reaches the Mac app's: Chrome starts the launcher the profile's
// manifest names, frames go over its stdin and stdout, and the host calls the app's /local. The
// page is a fixture served on loopback, which the dev build may script without a click, as
// activeTab lets a person's click do on any page.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { z } from "zod";
import { untilBodyHolds } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { installNativeHostFixture, saveFromWorker } from "../harness/native-host-fixture";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const ARTICLE_PATH = "/essays/file-over-app";
const TITLE = "File over app";
const PASSAGE = "Apps are ephemeral, and the files they write outlast every one of them.";
const ITEM_PATH = `Unsorted/${TITLE}.md`;

const ARTICLE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  `<title>${TITLE}</title>`,
  "</head><body><article>",
  `<h1>${TITLE}</h1>`,
  "<p>If you want to create digital artifacts that last, they must be files you can control.</p>",
  `<p id="passage">${PASSAGE}</p>`,
  "<p>The file is the one thing every app agrees on, so it is the thing to keep.</p>",
  "</article></body></html>",
].join("\n");

const boundAddressSchema = z.object({ port: z.number().int() });

const startArticleServer = async (): Promise<{ server: Server; url: string }> => {
  const server = createServer((request, response) => {
    if (request.url === ARTICLE_PATH) {
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
  return { server, url: `http://127.0.0.1:${String(port)}${ARTICLE_PATH}` };
};

export const browserExtension: Scenario = {
  description:
    "the dev extension in a real Chromium reaches the app through its native host: the welcome page says connected, a page save lands with its url and title, a second says already saved, a selection save leaves its highlight, and a stopped app answers app-unavailable",
  name: "browser-extension",
  async run(ctx) {
    const app = await ctx.boot({ name: "extension" });
    const article = await startArticleServer();
    try {
      const fixture = await installNativeHostFixture({
        dataDir: app.dataDir,
        repoRoot: ctx.repoRoot,
        scratchDir: ctx.scratchDir,
      });
      const browser = await ctx.browser("extension", { launchFlags: fixture.launchFlags });

      ctx.log("the article opens, and the welcome page reaches the app's library");
      await browser(["open", article.url], 60_000);
      await browser(["tab", "new", fixture.extensionPage("welcome.html")], 60_000);
      await untilBodyHolds(browser, [`Connected to ${path.basename(app.vaultDir)}`], 60_000);

      ctx.log("a save lands in Unsorted with the page's url and title");
      const first = await saveFromWorker(browser, null);
      expectEq(
        first,
        { created: true, kind: "saved", path: ITEM_PATH, title: TITLE },
        "the first save's answer",
      );
      const onDisk = await readFile(path.join(app.vaultDir, ITEM_PATH), "utf-8");
      expect(
        onDisk.includes(`url: ${article.url}`),
        `the saved item does not carry the page's url:\n${onDisk}`,
      );

      ctx.log("a second save of the same page says it is already in the library");
      const second = await saveFromWorker(browser, null);
      expectEq(
        second,
        { created: false, kind: "saved", path: ITEM_PATH, title: TITLE },
        "the second save's answer",
      );

      ctx.log("a save with a selection leaves a highlight quoting it");
      const highlighted = await saveFromWorker(browser, "passage");
      expect(
        highlighted.kind === "saved" && !highlighted.created,
        `the selection's save answered ${JSON.stringify(highlighted)}`,
      );
      // waiting while the item is still a stub, anchored once its text holds the passage
      const { annotations } = await pollUntil(
        async () => await app.api.annotations.list({ path: ITEM_PATH }),
        (listed) => listed.annotations.some((annotation) => annotation.quote === PASSAGE),
        {
          deadlineMs: 30_000,
          describe: (listed) =>
            `no annotation quotes the selection: ${JSON.stringify(listed.annotations)}`,
        },
      );
      const highlight = annotations.find((annotation) => annotation.quote === PASSAGE);
      expect(
        highlight !== undefined && ["waiting", "anchored"].includes(highlight.state),
        `the selection's highlight is ${JSON.stringify(highlight)}`,
      );

      ctx.log("with the app stopped, a save says the app could not be reached");
      await app.stop();
      const stopped = await saveFromWorker(browser, null);
      expectEq(
        stopped.kind === "refused" ? stopped.reason : stopped.kind,
        "app-unavailable",
        "a save with the app stopped",
      );
    } finally {
      article.server.close();
    }
  },
};
