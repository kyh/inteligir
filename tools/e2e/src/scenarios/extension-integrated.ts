// an extension save, end to end across the lanes: the dev build in a real Chromium captures the
// page as the person sees it (X), the native host hands it to the app, the app reads the article
// out of that supplied page and never requests it (S1), and the selection saved with it is placed
// in the article's own text (S3). The page writes its passage with its own script after it loads,
// so the passage is in the page the browser shows and in no markup the server ever sent: a save
// that fetched the page could not hold it. The page is served on loopback, which the dev build may
// script without a click; the app reads nothing from such an address, so its text can only be
// the supplied page's.

import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import path from "node:path";
import { z } from "zod";
import { untilBodyHolds } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { installNativeHostFixture, saveFromWorker } from "../harness/native-host-fixture";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const ARTICLE_PATH = "/essays/file-over-app";
const TITLE = "File over app";
const ITEM_PATH = `Unsorted/${TITLE}.md`;
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

const MARKED = new RegExp(
  String.raw`%%i:(?<id>[a-z0-9]+):start%%${PASSAGE.replaceAll(".", String.raw`\.`)}%%i:\k<id>:end%%`,
  "u",
);

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

const frontmatterOf = (content: string): string =>
  /^---\n(?<yaml>[\s\S]*?)\n---\n/u.exec(content)?.groups?.["yaml"] ?? "";

export const extensionIntegrated: Scenario = {
  description:
    "an extension save of a fixture page with a selection takes its text from the supplied page and anchors the highlight",
  name: "extension-integrated",
  async run(ctx) {
    const app = await ctx.boot({ name: "extension" });
    const article = await startArticleServer();
    try {
      const fixture = await installNativeHostFixture({
        dataDir: app.dataDir,
        repoRoot: ctx.repoRoot,
        scratchDir: ctx.scratchDir,
      });
      const browser = await ctx.browser("extension-integrated", {
        launchFlags: fixture.launchFlags,
      });

      ctx.log("the page loads and its own script writes the passage into the article");
      await browser(["open", article.url], 60_000);
      await untilBodyHolds(browser, [PASSAGE], DEADLINE_MS);
      expectEq(article.articleRequests(), 1, "requests for the article before the save");
      await browser(["tab", "new", fixture.extensionPage("welcome.html")], 60_000);
      await untilBodyHolds(browser, [`Connected to ${path.basename(app.vaultDir)}`], DEADLINE_MS);

      ctx.log("the passage selected, a save makes the item and its highlight together");
      const saved = await saveFromWorker(browser, "passage");
      expectEq(
        saved,
        { created: true, kind: "saved", path: ITEM_PATH, title: TITLE },
        "the save's answer",
      );

      ctx.log("the highlight is placed in the article's text, which came from the supplied page");
      const listed = await pollUntil(
        async () => await app.api.annotations.list({ path: ITEM_PATH }),
        (answer) =>
          answer.annotations.some(
            (annotation) => annotation.quote === PASSAGE && annotation.state === "anchored",
          ),
        {
          deadlineMs: DEADLINE_MS,
          describe: (answer) =>
            `the selection's highlight never anchored: ${JSON.stringify(answer.annotations)}`,
        },
      );
      expectEq(listed.annotations.length, 1, "the item's highlights");
      const [highlight] = listed.annotations;
      expectEq(highlight?.root.text, "", "the highlight's note, which a selection leaves empty");
      expectEq(highlight?.root.source, "user", "who the highlight is by");
      expectEq(highlight?.passage, PASSAGE, "the live text between the highlight's markers");

      const content = await readFile(path.join(app.vaultDir, ITEM_PATH), "utf-8");
      const frontmatter = frontmatterOf(content);
      for (const line of ["kind: link", `url: ${article.url}`]) {
        expect(
          frontmatter.split("\n").includes(line),
          `the item's frontmatter holds "${line}":\n${content}`,
        );
      }
      expect(/^fetched: \S+$/mu.test(frontmatter), `the item was read at capture:\n${content}`);
      expect(
        !frontmatter.includes("fetch-error:"),
        `the supplied page was read without an error:\n${content}`,
      );
      for (const words of [SERVED, CLOSING]) {
        expect(content.includes(words), `the article holds "${words}":\n${content}`);
      }
      const marked = MARKED.exec(content);
      expect(marked !== null, `the markers wrap the passage in the article:\n${content}`);
      expectEq(marked.groups?.["id"], highlight?.id, "the markers' id against the highlight's");
      expect(
        !content.includes("\n## Highlights\n"),
        `the passage was found in the text, so nothing sits under ## Highlights:\n${content}`,
      );
      expectEq(
        article.articleRequests(),
        1,
        "requests for the article after the save: the app never read it",
      );
    } finally {
      article.server.close();
    }
  },
};
