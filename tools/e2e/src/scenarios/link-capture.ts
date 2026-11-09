// a link saved to the library in the cloud, read by the Worker's own fill: the page served under
// a public name of its own (`../harness/page-fixture.ts`) lands with its facts, its cover and its
// article; a second save of the same link answers the item it already is; and a page on this
// machine's own loopback, a redirect to the cloud's metadata address and a page that is gone each
// keep their item, saying why it was not read.

import { once } from "node:events";
import { createServer } from "node:http";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { signInPhone, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { CloudWorker } from "../harness/cloud-worker";
import { startPageFixture } from "../harness/page-fixture";
import type { PageFixture, PageRoute } from "../harness/page-fixture";
import { pollUntil } from "../harness/poll";
import { solidPng } from "../harness/png-pixels";
import type { Scenario, ScenarioContext } from "../harness/scenario";
import { asPhone, itemFieldsOf, readFile, v1Client } from "../harness/v1-wire";
import type { V1Caller } from "../harness/v1-wire";
import type { V1Client } from "@repo/contract/cloud/v1";

const TITLE = "Keeping notes in plain files";
const COVER = solidPng(640, 400, [40, 90, 160, 255]);
const FILL_DEADLINE_MS = 60_000;

const ARTICLE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  `<title>${TITLE}</title>`,
  '<meta property="og:site_name" content="The Example Journal">',
  '<meta name="description" content="Why a folder of text files outlasts every app that reads it.">',
  '<meta name="author" content="Ada Example">',
  '<meta property="og:image" content="/cover.png">',
  "</head><body>",
  '<nav><a href="/">Home</a> <a href="/about">About</a></nav>',
  "<article>",
  `<h1>${TITLE}</h1>`,
  "<p>A folder of text files outlasts every app that reads it. The files are yours, on your own disk, in a format any program can open.</p>",
  "<h2>What lasts</h2>",
  "<p>Plain text has been readable for fifty years, and nothing suggests that will change soon.</p>",
  "</article>",
  "<footer>Written on a quiet afternoon.</footer>",
  "</body></html>",
].join("\n");

const ROUTES = {
  "/cover.png": { body: COVER, type: "image/png" },
  "/essay": { body: ARTICLE },
  "/to-metadata": { redirect: "http://169.254.169.254/latest/meta-data/" },
} satisfies Record<string, PageRoute>;

// what a fill that did not read its page says in the item, by why
const PRIVATE_NETWORK =
  "This address is on a private network, which the cloud can't reach, so its page isn't read.";
const PRIVATE_FROM_PUBLIC = "The page pointed at an address on your own network, so it isn't read.";
const GONE = "The site answered 404 (not found).";
const NOT_A_PAGE = "This address isn't one a page can be read from.";

type Library = V1Client["library"];

// the item once the fill has had its say
const settled = async (library: Library, id: string, label: string) =>
  await pollUntil(
    async () => await library.items.read({ id }),
    (read) => read.fields.fetchState !== "pending",
    { deadlineMs: FILL_DEADLINE_MS, describe: (read) => `${label} is ${read.fields.fetchState}` },
  );

const refusedWith = async (library: Library, url: string, sentence: string, label: string) => {
  const { item } = await library.items.saveLink({ url });
  const read = await settled(library, item.id, label);
  expectEq([read.fields.fetchState, read.fields.fetchError], ["failed", sentence], label);
};

const articleFills = async (
  ctx: ScenarioContext,
  worker: CloudWorker,
  phone: V1Caller,
  pages: PageFixture,
) => {
  const { library } = v1Client(worker, phone);
  ctx.log("a saved page is read by the cloud: its facts, its cover, its article and its title");
  const url = pages.publicUrl("/essay");
  const { created, item } = await library.items.saveLink({ url });
  expectEq(created, true, "the first save makes an item");
  const read = await settled(library, item.id, "the article");
  expectEq(
    {
      author: read.fields.author,
      description: read.fields.description,
      fetchError: read.fields.fetchError,
      fetchState: read.fields.fetchState,
      kind: read.fields.kind,
      site: read.fields.site,
      title: read.fields.title,
      url: read.fields.url,
    },
    {
      author: "Ada Example",
      description: "Why a folder of text files outlasts every app that reads it.",
      fetchError: null,
      fetchState: "filled",
      kind: "link",
      site: "The Example Journal",
      title: TITLE,
      url,
    },
    "the read item's facts",
  );
  for (const line of [
    "A folder of text files outlasts every app that reads it.",
    "## What lasts",
    "Plain text has been readable for fifty years",
  ]) {
    expect(
      read.view.markdown.includes(line),
      `the article holds "${line}":\n${read.view.markdown}`,
    );
  }
  expect(
    !read.view.markdown.includes("Written on a quiet afternoon."),
    `the page's footer is no part of its article:\n${read.view.markdown}`,
  );

  const fields = await itemFieldsOf(library, item.id);
  expect(fields?.fetchedAt !== null, `the item holds when it was read: ${JSON.stringify(fields)}`);
  const coverSha = fields?.coverSha ?? null;
  expect(coverSha !== null, `the item holds the page's cover: ${JSON.stringify(fields)}`);
  const cover = await readFile(worker, phone, coverSha);
  expectEq(cover.status, 200, "the cover's read");
  expectEq(
    Buffer.compare(Buffer.from(await cover.arrayBuffer()), Buffer.from(COVER)),
    0,
    "the cover's bytes against the page's",
  );

  ctx.log("a save of the same link answers the item it already is");
  const again = await library.items.saveLink({ url: `${url}?utm_source=feed` });
  expectEq([again.created, again.item.id], [false, item.id], "the resave");
};

// a page server on this machine's own loopback, which the cloud's fill must never reach: an address
// in private space is refused by its spelling, and any port but the web's before that
const loopbackRefused = async (ctx: ScenarioContext, library: Library) => {
  let reached = 0;
  const listener = createServer((_request, response) => {
    reached += 1;
    response.end("<title>never read</title>");
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = z.object({ port: z.number() }).parse(listener.address());
  try {
    ctx.log("a page on this machine's loopback is never fetched, and the item says why");
    await refusedWith(library, "http://localhost/", PRIVATE_NETWORK, "this machine's own name");
    await refusedWith(library, "http://192.168.1.1/", PRIVATE_NETWORK, "a home network's address");
    await refusedWith(library, `http://127.0.0.1:${String(port)}/`, NOT_A_PAGE, "a loopback port");
    expectEq(reached, 0, "requests that reached the loopback listener");
  } finally {
    listener.close();
  }
};

export const linkCapture: Scenario = {
  description:
    "a link saved to the cloud library is read by the Worker's fill: a page under a public name lands with its kind, url, site, author, description, cover and article, titled by the page; a resave of the same link answers the item it already is; a loopback page, a redirect to the metadata address and a page that is gone each keep the item with why",
  name: "link-capture",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const pages = await startPageFixture(ROUTES);
    try {
      const worker = await ctx.cloudWorker({ pages: pages.pages });
      await signUp(worker.origin);
      const phone = asPhone(await signInPhone(worker.origin));
      const { library } = v1Client(worker, phone);
      await articleFills(ctx, worker, phone, pages);
      await loopbackRefused(ctx, library);
      ctx.log("a redirect to the cloud's metadata address and a missing page keep their items");
      await refusedWith(
        library,
        pages.publicUrl("/to-metadata"),
        PRIVATE_FROM_PUBLIC,
        "the redirect to 169.254.169.254",
      );
      await refusedWith(library, pages.publicUrl("/missing"), GONE, "the missing page");
      expect(
        pages.requests().includes("/essay") && pages.requests().includes("/cover.png"),
        `the fill read the page and then its cover: ${pages.requests().join(", ")}`,
      );
    } finally {
      await pages.close();
    }
  },
};
