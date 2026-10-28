// The fill queue's consumer end to end inside workerd: a message for a saved link read through the
// guarded fetch (the platform's fetch stood in for), the page read by the one reader every device
// runs, its files kept in R2, and the reading landed in the account's cell; a page a later try may
// get past asked again later each time, then said in the item; the dead letters said too.

import { oembedEndpoint } from "@repo/notes/items/oembed";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import bareTitle from "@repo/page-reader/test-support/corpus/bare-title.html?raw";
import blogPost from "@repo/page-reader/test-support/corpus/blog-post.html?raw";
import complexTable from "@repo/page-reader/test-support/corpus/complex-table.html?raw";
import dialectHazards from "@repo/page-reader/test-support/corpus/dialect-hazards.html?raw";
import docsPage from "@repo/page-reader/test-support/corpus/docs-page.html?raw";
import newsArticle from "@repo/page-reader/test-support/corpus/news-article.html?raw";
import recipe from "@repo/page-reader/test-support/corpus/recipe.html?raw";
import scriptHeavy from "@repo/page-reader/test-support/corpus/script-heavy.html?raw";
import videoPage from "@repo/page-reader/test-support/corpus/video-page.html?raw";
import { blobKey } from "../library/cell-blobs";
import { cellOf, inCell } from "../test-support/library-cell";
import { FILL_FAILED_QUEUE } from "./fill-queues";
import {
  deliver,
  filePage,
  htmlPage,
  fieldsIn,
  itemIn,
  libraryIn,
  pngOf,
  savedLink,
  serveWeb,
  textOfSection,
} from "./test-support/fill-cell";

afterEach(() => {
  vi.restoreAllMocks();
});

const CORPUS = {
  "bare-title": bareTitle,
  "blog-post": blogPost,
  "complex-table": complexTable,
  "dialect-hazards": dialectHazards,
  "docs-page": docsPage,
  "news-article": newsArticle,
  recipe,
  "script-heavy": scriptHeavy,
  "video-page": videoPage,
} as const;

const PDF = new TextEncoder().encode("%PDF-1.7\n% a file a link answered with\n");

describe("a saved link's reading", () => {
  it("reads the page into the item: its article, its facts, a title for the address, its cover", async () => {
    const url = "https://pages.example/posts/item";
    const { accountId, itemId, job } = await savedLink(url);
    const cover = pngOf(1200, 630);
    const web = serveWeb({
      "https://cdn.fieldnotes.example/cover@2x.jpg": filePage(cover, "image/png"),
      [url]: htmlPage(blogPost),
    });
    expect(await deliver(job)).toMatchObject({ acked: true, retried: false });
    const item = await itemIn(accountId, itemId);
    expect(item?.fields).toMatchObject({
      author: "A. Lindqvist (JSON-LD)",
      description: "Plain files outlive the apps that made them.",
      fetchError: null,
      fetchState: "filled",
      lang: "en",
      published: "2024-03-05",
      site: "Field Notes",
      title: "Keep your notes in files",
    });
    expect(textOfSection(item, "article")).toContain("contract with the future");
    expect(textOfSection(item, "note")).toBe("[]");
    // the page first, then its first cover candidate, asked as a browser would
    expect(web.asked.map((hop) => hop.url)).toEqual([
      url,
      "https://cdn.fieldnotes.example/cover@2x.jpg",
    ]);
    expect(web.asked[0]?.headers.get("user-agent")).toContain("inteligir");
    const kept = await env.BLOBS.get(blobKey(accountId, item?.fields.coverSha ?? ""));
    expect(new Uint8Array((await kept?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(cover);
  });

  it.each(Object.entries(CORPUS))(
    "lands the corpus page %s as the reader reads it",
    async (name, html) => {
      const url = `https://pages.example/corpus/${name}`;
      const { accountId, itemId, job } = await savedLink(url);
      serveWeb({ [url]: htmlPage(html) });
      expect(await deliver(job)).toMatchObject({ acked: true });
      const item = await itemIn(accountId, itemId);
      expect(item?.fields).toMatchObject({ fetchError: null, fetchState: "filled" });
      // every page gives an article or, a video's, the words it says of itself
      const article = [...(item?.blocks.values() ?? [])].filter(
        (stored) => stored.section === "article",
      );
      expect(article.length > 0 || item?.fields.description !== null).toBe(true);
    },
  );

  it("reads a video host's page as the video's, its description the article", async () => {
    const url = "https://www.youtube.com/watch?v=abc123";
    const { accountId, itemId, job } = await savedLink(url);
    const endpoint = oembedEndpoint(url, null) ?? "";
    const web = serveWeb({
      [endpoint]: () =>
        Response.json({ author_name: "The Baker", provider_name: "YouTube", title: "Sourdough" }),
      [url]: htmlPage(videoPage),
    });
    await deliver(job);
    expect(web.asked.map((hop) => hop.url)).toContain(endpoint);
    const item = await itemIn(accountId, itemId);
    expect(item?.fields).toMatchObject({
      // the page's own byline wins over what the host's oEmbed says
      author: "Crumb Kitchen",
      fetchState: "filled",
      kind: "video",
    });
    expect(textOfSection(item, "article")).not.toBe("[]");
  });

  it("keeps a PDF the address answered with as the item's original", async () => {
    const url = "https://papers.example/files-over-apps.pdf";
    const { accountId, itemId, job } = await savedLink(url);
    serveWeb({ [url]: filePage(PDF, "application/pdf") });
    await deliver(job);
    const item = await itemIn(accountId, itemId);
    expect(item?.fields).toMatchObject({ fetchState: "filled", kind: "pdf" });
    const kept = await env.BLOBS.head(blobKey(accountId, item?.fields.originalSha ?? ""));
    expect(kept?.httpMetadata?.contentType).toBe("application/pdf");
    expect(kept?.size).toBe(PDF.length);
  });

  it("keeps a picture the address answered with as the item and its cover", async () => {
    const url = "https://photos.example/harbour";
    const { accountId, itemId, job } = await savedLink(url);
    serveWeb({ [url]: filePage(pngOf(800, 600), "image/png") });
    await deliver(job);
    const item = await itemIn(accountId, itemId);
    expect(item?.fields.kind).toBe("image");
    expect(item?.fields.coverSha).toBe(item?.fields.originalSha);
  });

  it("reads a page of this app's own site through the platform's public route", async () => {
    // the runtime reads its own zone through the public internet, under the flag the deployed
    // Worker and these suites share (apps/web/compatibility.ts)
    expect(Cloudflare.compatibilityFlags["global_fetch_strictly_public"]).toBe(true);
    const url = "https://inteligir.com/blog/files-over-apps";
    const { accountId, itemId, job } = await savedLink(url);
    const web = serveWeb({ [url]: htmlPage(blogPost) });
    await deliver(job);
    expect(web.asked[0]?.url).toBe(url);
    expect(await fieldsIn(accountId, itemId)).toMatchObject({ fetchState: "filled" });
  });
});

describe("a reading that did not land a page", () => {
  it("asks a busy site again later each time, then says so in the item", async () => {
    const url = "https://busy.example/post";
    const { accountId, itemId, job } = await savedLink(url);
    serveWeb({ [url]: htmlPage("<p>busy</p>", 503) });
    const delays = [];
    for (const attempts of [1, 2, 3]) {
      const delivered = await deliver(job, { attempts });
      expect(delivered).toMatchObject({ acked: false, retried: true });
      delays.push(delivered.delaySeconds);
    }
    expect(delays).toEqual([30, 60, 120]);
    expect(await fieldsIn(accountId, itemId)).toMatchObject({ fetchState: "pending" });
    expect(await deliver(job, { attempts: 4 })).toMatchObject({ acked: true, retried: false });
    expect(await fieldsIn(accountId, itemId)).toMatchObject({
      fetchError: "The site answered 503 (service unavailable).",
      fetchState: "failed",
    });
  });

  it("says a page that is not there at once, with no try again", async () => {
    const url = "https://gone.example/post";
    const { accountId, itemId, job } = await savedLink(url);
    serveWeb({});
    expect(await deliver(job)).toMatchObject({ acked: true, retried: false });
    expect(await fieldsIn(accountId, itemId)).toMatchObject({
      fetchError: "The site answered 404 (not found).",
      fetchState: "failed",
    });
  });

  it("asks nothing of an address on a private network", async () => {
    const { accountId, itemId, job } = await savedLink("http://192.168.1.20/admin");
    const web = serveWeb({});
    expect(await deliver(job)).toMatchObject({ acked: true });
    expect(web.asked).toEqual([]);
    expect(await fieldsIn(accountId, itemId)).toMatchObject({
      fetchError:
        "This address is on a private network, which the cloud can't reach, so its page isn't read.",
    });
  });

  it("follows no redirect to a private address", async () => {
    const url = "https://short.example/x";
    const { accountId, itemId, job } = await savedLink(url);
    const web = serveWeb({
      [url]: () => new Response(null, { headers: { location: "http://10.0.0.5/" }, status: 302 }),
    });
    await deliver(job);
    expect(web.asked.map((hop) => hop.url)).toEqual([url]);
    expect(await fieldsIn(accountId, itemId)).toMatchObject({
      fetchError: "The page pointed at an address on your own network, so it isn't read.",
    });
  });

  it("says in the item what the queue's retries could not read", async () => {
    const { accountId, itemId, job } = await savedLink("https://never.example/post");
    const web = serveWeb({});
    expect(await deliver(job, { queue: FILL_FAILED_QUEUE })).toMatchObject({ acked: true });
    expect(web.asked).toEqual([]);
    expect(await fieldsIn(accountId, itemId)).toMatchObject({
      fetchError: "The page couldn't be reached.",
      fetchState: "failed",
    });
  });
});

describe("a message the consumer meets", () => {
  it("drops one no deploy sends, and reads nothing for it", async () => {
    const web = serveWeb({});
    expect(await deliver({ itemId: "x", url: "ftp://nowhere" })).toMatchObject({ acked: true });
    expect(web.asked).toEqual([]);
  });

  it("reads nothing for an item that no longer waits, and lands a message met twice once", async () => {
    const url = "https://pages.example/twice";
    const { accountId, itemId, job } = await savedLink(url);
    const web = serveWeb({ [url]: htmlPage(blogPost) });
    await deliver(job);
    const first = await itemIn(accountId, itemId);
    const asked = web.asked.length;
    expect(await deliver(job)).toMatchObject({ acked: true });
    expect(web.asked.length).toBe(asked);
    expect(await itemIn(accountId, itemId)).toEqual(first);

    const deleted = await savedLink("https://pages.example/deleted");
    await inCell(cellOf(deleted.accountId), async (state) => {
      await libraryIn(state, deleted.accountId).items.delete({ ids: [deleted.itemId] });
    });
    expect(await deliver(deleted.job)).toMatchObject({ acked: true });
    expect(web.asked.length).toBe(asked);
  });
});
