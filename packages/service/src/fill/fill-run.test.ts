// The fill job's run over Postgres: a link saved to read later, its page read through the guarded
// read from a suite's web, by the one reader every device runs, its files kept in the library and
// the reading landed in its item; a page a later try may get past asked again until the last try,
// which says the page's own failure, and past every try the page said unreached; a link the
// built-in agent saved, read without its turn's Undo losing it.

import { randomUUID } from "node:crypto";

import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { stubFields } from "@repo/contract/library/item-makes";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";
import { paragraph } from "@repo/contract/test-support/library-items";
import { db } from "@repo/db/drizzle-client";
import { file, itemFile, job } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import bareTitle from "@repo/page-reader/test-support/corpus/bare-title.html?raw";
import blogPost from "@repo/page-reader/test-support/corpus/blog-post.html?raw";
import complexTable from "@repo/page-reader/test-support/corpus/complex-table.html?raw";
import dialectHazards from "@repo/page-reader/test-support/corpus/dialect-hazards.html?raw";
import docsPage from "@repo/page-reader/test-support/corpus/docs-page.html?raw";
import newsArticle from "@repo/page-reader/test-support/corpus/news-article.html?raw";
import recipe from "@repo/page-reader/test-support/corpus/recipe.html?raw";
import scriptHeavy from "@repo/page-reader/test-support/corpus/script-heavy.html?raw";
import videoPage from "@repo/page-reader/test-support/corpus/video-page.html?raw";
import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

import { fileOf } from "../files/file-names";
import { FILE_STORE } from "../files/file-store-of";
import { releaseUnnamedFiles } from "../files/file-release";
import { drainJobs } from "../jobs/drain-jobs";
import { JOB_RUNS, leasedRun } from "../jobs/job-kinds";
import { sealTurnSet } from "../library/library-change-sets";
import { readItemWhole } from "../library/library-rows";
import { filePage, htmlPage, pngOf, redirect, serveWeb } from "../test-support/fill-web";
import {
  libraryAs,
  makeAccount,
  personalLibrary,
  seedItem,
  sessionPrincipal,
} from "../test-support/library-fixture";
import type { FillJob } from "./fill-job";
import { fillRun } from "./fill-run";
import { oembedEndpoint } from "./oembed";
import { pageFetch } from "./page-fetch";

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

// an app shell, whose words only its host's oEmbed answer holds
const SHELL = "<html><head><title>X</title></head><body><div id=root></div></body></html>";
const hostsWords = () =>
  Response.json({
    author_name: "A Poster",
    html: `<blockquote><p>${"Words only the host's answer holds. ".repeat(6)}</p></blockquote>`,
    provider_name: "X",
  });

const thousandWs = (): BodyBlock => ({
  block: paragraph(randomUUID(), "w".repeat(1000)),
  section: "note",
});

const pageDiscovering = (endpoint: string): string =>
  `<html><head><title>A post</title><link rel="alternate" type="application/json+oembed" href="${endpoint}"></head><body><article><p>${"Words worth keeping. ".repeat(40)}</p></article></body></html>`;

interface SavedLink {
  readonly accountId: string;
  readonly itemId: string;
  readonly job: FillJob;
}

// a link saved to read later in a fresh account, and the reading its save asked for
const savedLink = async (url: string): Promise<SavedLink> => {
  const { accountId, library } = await personalLibrary();
  const saved = await library.items.saveLink({ url });
  return {
    accountId,
    itemId: saved.item.id,
    job: { coverHint: null, itemId: saved.item.id, url: saved.item.fields.url ?? url },
  };
};

type Web = ReturnType<typeof serveWeb>;

const runOver = (web: Web) =>
  leasedRun(fillRun(pageFetch({ deadlineMs: 20_000, fetch: web.fetch })));

// the job run as the drain's `attempts`-th lease of it hands it over
const deliver = async (
  { accountId, job: payload }: Pick<SavedLink, "accountId" | "job">,
  web: Web,
  attempts = 1,
) =>
  await runOver(web)({
    accountId,
    attempts,
    id: `fill:${payload.itemId}`,
    kind: "fill",
    payload,
    runAt: 0,
  });

const itemIn = async (accountId: string, itemId: string) => {
  const whole = await readItemWhole(db, accountId, itemId);
  return whole === null ? null : { blocks: whole.blocks, fields: whole.item.fields };
};

const fieldsIn = async (accountId: string, itemId: string) => {
  const item = await itemIn(accountId, itemId);
  return item?.fields ?? null;
};

const textOfSection = (
  item: Awaited<ReturnType<typeof itemIn>>,
  section: "note" | "article",
): string =>
  JSON.stringify(
    (item?.blocks ?? []).filter((held) => held.section === section).map((held) => held.block),
  );

// the bytes the library keeps under a sha
const keptBytes = async (accountId: string, sha: string): Promise<Uint8Array | null> => {
  const held = await fileOf(db, accountId, sha);
  const read = held === null ? null : await FILE_STORE.read(held.pathname, null);
  return read === null ? null : new Uint8Array(await new Response(read.body).arrayBuffer());
};

const namedBy = async (accountId: string, itemId: string) =>
  await db
    .select({ sha: itemFile.sha256 })
    .from(itemFile)
    .where(and(eq(itemFile.accountId, accountId), eq(itemFile.itemId, itemId)));

dbSuite("a saved link's reading", () => {
  // the first reading loads the page reader's chunk, seconds of import on a busy runner
  it(
    "reads the page into the item: its article, its facts, a title for the address, its cover kept and named",
    { timeout: 30_000 },
    async () => {
      const url = "https://pages.example/posts/item";
      const saved = await savedLink(url);
      const cover = pngOf(1200, 630);
      const web = serveWeb({
        "https://cdn.fieldnotes.example/cover@2x.jpg": filePage(cover, "image/png"),
        [url]: htmlPage(blogPost),
      });
      await expect(deliver(saved, web)).resolves.toBe("done");
      const item = await itemIn(saved.accountId, saved.itemId);
      expect(item?.fields).toMatchObject({
        author: "Ada Lindqvist",
        description: "A short argument for plain files over databases.",
        lang: "en",
        published: "2024-03-04",
        reading: { state: "read" },
        site: "Field Notes",
        title: "Keep your notes in files",
      });
      expect(textOfSection(item, "article")).toContain("contract with the future");
      expect(textOfSection(item, "note")).toBe("[]");
      // the page first, then its first cover candidate, asked as a browser would
      expect(web.asked.map((hop) => hop.url)).toStrictEqual([
        url,
        "https://cdn.fieldnotes.example/cover@2x.jpg",
      ]);
      expect(web.asked[0]?.headers.get("user-agent")).toContain("inteligir");
      const coverSha = item?.fields.coverSha ?? "";
      await expect(keptBytes(saved.accountId, coverSha)).resolves.toStrictEqual(cover);
      await expect(namedBy(saved.accountId, saved.itemId)).resolves.toStrictEqual([
        { sha: coverSha },
      ]);
    },
  );

  // each corpus page is a whole site's markup read through linkedom and the codec on purpose,
  // seconds of CPU on a runner busy with other suites
  it.each(Object.entries(CORPUS))(
    "lands the corpus page %s as the reader reads it",
    { timeout: 30_000 },
    async (name, html) => {
      const url = `https://pages.example/corpus/${name}`;
      const saved = await savedLink(url);
      await expect(deliver(saved, serveWeb({ [url]: htmlPage(html) }))).resolves.toBe("done");
      const item = await itemIn(saved.accountId, saved.itemId);
      expect(item?.fields).toMatchObject({ reading: { state: "read" } });
      // every page gives an article or, a video's, the words it says of itself
      const article = (item?.blocks ?? []).filter((held) => held.section === "article");
      expect(article.length > 0 || item?.fields.description !== null).toBe(true);
    },
  );

  it("fills an item whose redirects end at an address longer than an item holds", async () => {
    const url = "https://pages.example/long-redirect";
    const longer = `https://pages.example/${"a".repeat(9000)}`;
    const saved = await savedLink(url);
    await deliver(saved, serveWeb({ [longer]: htmlPage(blogPost), [url]: redirect(longer) }));
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      reading: { state: "read" },
      url,
    });
  });

  it("reads a video host's page as the video's, its description the article", async () => {
    const url = "https://www.youtube.com/watch?v=abc123";
    const saved = await savedLink(url);
    const endpoint = oembedEndpoint(url, null) ?? "";
    const web = serveWeb({
      [endpoint]: () =>
        Response.json({ author_name: "The Baker", provider_name: "YouTube", title: "Sourdough" }),
      [url]: htmlPage(
        videoPage.replace("<head>", '<head><meta name="author" content="Crumb Kitchen">'),
      ),
    });
    await deliver(saved, web);
    expect(web.asked.map((hop) => hop.url)).toContain(endpoint);
    const item = await itemIn(saved.accountId, saved.itemId);
    expect(item?.fields).toMatchObject({
      // the page's own byline wins over what the host's oEmbed says
      author: "Crumb Kitchen",
      kind: "video",
      reading: { state: "read" },
    });
    expect(textOfSection(item, "article")).not.toBe("[]");
  });

  it("reads a short link to a video as the video it became, its description the article", async () => {
    const url = "https://bit.ly/x";
    const video = "https://www.youtube.com/watch?v=abc123";
    const saved = await savedLink(url);
    await deliver(saved, serveWeb({ [url]: redirect(video, 301), [video]: htmlPage(videoPage) }));
    const item = await itemIn(saved.accountId, saved.itemId);
    expect(item?.fields).toMatchObject({ kind: "video", reading: { state: "read" } });
    const article = textOfSection(item, "article");
    expect(article).toContain("A quick guide to a first loaf");
    expect(article).not.toContain("Great video");
  });

  it("keeps a song's text its description when its page moves to an address that names none", async () => {
    const url = "https://open.spotify.com/track/abc123";
    const moved = "https://open.spotify.com/intl-de/track/abc123";
    const saved = await savedLink(url);
    await deliver(saved, serveWeb({ [moved]: htmlPage(videoPage), [url]: redirect(moved, 301) }));
    const item = await itemIn(saved.accountId, saved.itemId);
    expect(item?.fields).toMatchObject({ kind: "audio", reading: { state: "read" } });
    expect(textOfSection(item, "article")).toContain("A quick guide to a first loaf");
  });

  it("reads a post an app shell hides from what the host's oEmbed says of it", async () => {
    const url = "https://x.com/kyh/status/1";
    const saved = await savedLink(url);
    await deliver(
      saved,
      serveWeb({ [oembedEndpoint(url, null) ?? ""]: hostsWords, [url]: htmlPage(SHELL) }),
    );
    const item = await itemIn(saved.accountId, saved.itemId);
    expect(item?.fields).toMatchObject({
      author: "A Poster",
      reading: { state: "read" },
      site: "X",
    });
    expect(textOfSection(item, "article")).toContain("Words only the host's answer holds.");
  });

  it("asks the host a short link landed on for what an app shell hides", async () => {
    const url = "https://t.co/abc";
    const post = "https://x.com/kyh/status/1";
    const saved = await savedLink(url);
    await deliver(
      saved,
      serveWeb({
        [oembedEndpoint(post, null) ?? ""]: hostsWords,
        [post]: htmlPage(SHELL),
        [url]: redirect(post, 301),
      }),
    );
    const item = await itemIn(saved.accountId, saved.itemId);
    expect(textOfSection(item, "article")).toContain("Words only the host's answer holds.");
  });

  it("asks the saved address's host when the page landed on a sign-in", async () => {
    const url = "https://x.com/kyh/status/1";
    const login = "https://x.com/i/flow/login";
    const saved = await savedLink(url);
    await deliver(
      saved,
      serveWeb({
        [login]: htmlPage(SHELL),
        [oembedEndpoint(url, null) ?? ""]: hostsWords,
        [url]: redirect(login),
      }),
    );
    const item = await itemIn(saved.accountId, saved.itemId);
    expect(textOfSection(item, "article")).toContain("Words only the host's answer holds.");
  });

  it.each([
    "http://10.0.0.5/oembed?url=post",
    "http://127.0.0.1:8080/oembed?url=post",
    "http://169.254.169.254/latest/meta-data/",
  ])("never asks %s, a discovery link into private space", async (endpoint) => {
    const url = "https://pages.example/posts/discovering";
    const saved = await savedLink(url);
    const web = serveWeb({
      [endpoint]: () => Response.json({ author_name: "Inside the network" }),
      [url]: htmlPage(pageDiscovering(endpoint)),
    });
    await expect(deliver(saved, web)).resolves.toBe("done");
    expect(web.asked.map((hop) => hop.url)).toStrictEqual([url]);
    const item = await itemIn(saved.accountId, saved.itemId);
    expect(item?.fields).toMatchObject({
      author: null,
      reading: { state: "read" },
      title: "A post",
    });
    expect(textOfSection(item, "article")).toContain("Words worth keeping.");
  });

  it("reads the page alone when its discovery link answers no JSON", async () => {
    const url = "https://pages.example/posts/discovering";
    const endpoint = "https://pages.example/oembed?url=post";
    const saved = await savedLink(url);
    const web = serveWeb({
      [endpoint]: htmlPage("<html><body>Not an answer</body></html>"),
      [url]: htmlPage(pageDiscovering(endpoint)),
    });
    await expect(deliver(saved, web)).resolves.toBe("done");
    expect(web.asked.map((hop) => hop.url)).toContain(endpoint);
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      author: null,
      reading: { state: "read" },
      title: "A post",
    });
  });

  it("keeps a PDF the address answered with as the item's original", async () => {
    const url = "https://papers.example/files-over-apps.pdf";
    const saved = await savedLink(url);
    await deliver(saved, serveWeb({ [url]: filePage(PDF, "application/pdf") }));
    const fields = await fieldsIn(saved.accountId, saved.itemId);
    expect(fields).toMatchObject({ kind: "pdf", reading: { state: "read" } });
    const held = await fileOf(db, saved.accountId, fields?.originalSha ?? "");
    expect(held).toMatchObject({ bytes: PDF.length, mime: "application/pdf" });
  });

  it("keeps a picture the address answered with as the item and its cover", async () => {
    const url = "https://photos.example/harbour";
    const saved = await savedLink(url);
    await deliver(saved, serveWeb({ [url]: filePage(pngOf(800, 600), "image/png") }));
    const fields = await fieldsIn(saved.accountId, saved.itemId);
    expect(fields?.kind).toBe("image");
    expect(fields?.coverSha).toBe(fields?.originalSha);
  });

  it("is run by the drain the save asked it of", async () => {
    const url = "https://pages.example/drained";
    const saved = await savedLink(url);
    const web = serveWeb({ [url]: htmlPage(blogPost) });
    const runs = { ...JOB_RUNS, fill: runOver(web) };
    await expect(
      drainJobs({ accountId: saved.accountId, budgetMs: 10_000, runs }),
    ).resolves.toStrictEqual({ dropped: 0, failed: 0, ran: 1 });
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      reading: { state: "read" },
    });
    await expect(
      db.select().from(job).where(eq(job.accountId, saved.accountId)),
    ).resolves.toStrictEqual([]);
  });
});

dbSuite("a reading that did not land a page", () => {
  it("asks a busy site again until its last try, which says so in the item", async () => {
    const url = "https://busy.example/post";
    const saved = await savedLink(url);
    const web = serveWeb({ [url]: htmlPage("<p>busy</p>", 503) });
    for (const attempts of [1, 2, 3]) {
      await expect(deliver(saved, web, attempts)).resolves.toBe("retry");
    }
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      reading: { state: "pending" },
    });
    await expect(deliver(saved, web, 4)).resolves.toBe("done");
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      reading: { error: "The site answered 503 (service unavailable).", state: "failed" },
    });
  });

  it("says a page that is not there at once, with no try again", async () => {
    const saved = await savedLink("https://gone.example/post");
    await expect(deliver(saved, serveWeb({}))).resolves.toBe("done");
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      reading: { error: "The site answered 404 (not found).", state: "failed" },
    });
  });

  it.each([
    [
      "http://nas.local/admin",
      "This address is on a private network, which the cloud can't reach, so its page isn't read.",
    ],
    [
      "http://192.168.1.20/admin",
      "The cloud opens pages by name, so an address written as numbers isn't read.",
    ],
  ])("asks nothing of %s, and says why at once", async (url, error) => {
    const saved = await savedLink(url);
    const web = serveWeb({});
    await expect(deliver(saved, web)).resolves.toBe("done");
    expect(web.asked).toStrictEqual([]);
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      reading: { error, state: "failed" },
    });
  });

  it("follows no redirect to a name on a private network", async () => {
    const url = "https://short.example/x";
    const saved = await savedLink(url);
    const web = serveWeb({ [url]: redirect("http://router.lan/") });
    await deliver(saved, web);
    expect(web.asked.map((hop) => hop.url)).toStrictEqual([url]);
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      reading: {
        error: "The page pointed at an address on your own network, so it isn't read.",
        state: "failed",
      },
    });
  });

  it("says the page couldn't be reached once every try threw, reading nothing more", async () => {
    const saved = await savedLink("https://never.example/post");
    const web = serveWeb({});
    await expect(deliver(saved, web, 5)).resolves.toBe("done");
    expect(web.asked).toStrictEqual([]);
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      reading: { error: "The page couldn't be reached.", state: "failed" },
    });
  });

  it("says a page whose text the item can't hold as text that couldn't be saved", async () => {
    const accountId = await makeAccount();
    const url = "https://pages.example/too-much";
    // a note within a few hundred bytes of what a body holds, which the page's article carries past
    const size = utf8ByteLength(JSON.stringify(thousandWs()));
    const blocks = Array.from({ length: Math.floor((BODY_MAX_BYTES - 1000) / (size + 1)) }, () =>
      thousandWs(),
    );
    const seeded = await seedItem(accountId, {
      blocks,
      fields: stubFields({ folderId: null, savedAt: Date.now(), tags: [], url }),
    });
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deliver(
      { accountId, job: { coverHint: null, itemId: seeded.id, url } },
      serveWeb({ [url]: htmlPage(blogPost) }),
    );
    expect(warned).toHaveBeenCalledWith({ event: "fill-landing-refused", refusal: "too-large" });
    warned.mockRestore();
    const item = await itemIn(accountId, seeded.id);
    expect(item?.fields.reading).toMatchObject({
      error: "The page's text couldn't be saved.",
      state: "failed",
    });
    expect(item?.blocks).toHaveLength(blocks.length);
  });
});

dbSuite("a job the run meets", () => {
  it("drops a payload no build asks, and reads nothing for it", async () => {
    const accountId = await makeAccount();
    const web = serveWeb({});
    await expect(
      runOver(web)({
        accountId,
        attempts: 1,
        id: "fill:x",
        kind: "fill",
        payload: { itemId: "x", url: "ftp://nowhere" },
        runAt: 0,
      }),
    ).resolves.toBe("unreadable");
    expect(web.asked).toStrictEqual([]);
  });

  it("reads nothing for an item that no longer waits, and lands a job met twice once", async () => {
    const url = "https://pages.example/twice";
    const saved = await savedLink(url);
    const web = serveWeb({ [url]: htmlPage(blogPost) });
    await deliver(saved, web);
    const first = await itemIn(saved.accountId, saved.itemId);
    const asked = web.asked.length;
    await expect(deliver(saved, web)).resolves.toBe("done");
    expect(web.asked).toHaveLength(asked);
    await expect(itemIn(saved.accountId, saved.itemId)).resolves.toStrictEqual(first);

    const deleted = await savedLink("https://pages.example/deleted");
    await libraryAs(sessionPrincipal(deleted.accountId)).items.delete({ ids: [deleted.itemId] });
    await expect(deliver(deleted, web)).resolves.toBe("done");
    expect(web.asked).toHaveLength(asked);
  });

  it("lets go a cover the item stopped waiting for while its page was read, by housekeeping", async () => {
    const url = "https://pages.example/deleted-meanwhile";
    const saved = await savedLink(url);
    const cover = pngOf(1200, 630);
    const library = libraryAs(sessionPrincipal(saved.accountId));
    const web = serveWeb({
      "https://cdn.fieldnotes.example/cover@2x.jpg": async () => {
        // the person deletes the item while its cover is fetched
        await library.items.delete({ ids: [saved.itemId] });
        return await filePage(cover, "image/png")();
      },
      [url]: htmlPage(blogPost),
    });
    await deliver(saved, web);
    await expect(fieldsIn(saved.accountId, saved.itemId)).resolves.toMatchObject({
      reading: { state: "pending" },
    });
    const kept = await db
      .select({ sha: file.sha256 })
      .from(file)
      .where(eq(file.accountId, saved.accountId));
    expect(kept).toHaveLength(1);
    await expect(namedBy(saved.accountId, saved.itemId)).resolves.toStrictEqual([]);
    const dayOn = Date.now() + 25 * 60 * 60_000;
    await expect(db.transaction(async (tx) => await releaseUnnamedFiles(tx, dayOn))).resolves.toBe(
      1,
    );
    await expect(
      db.select().from(file).where(eq(file.accountId, saved.accountId)),
    ).resolves.toStrictEqual([]);
  });
});

dbSuite("a link the built-in agent saved", () => {
  it("is read at once, its turn still open, and the turn's Undo still takes it back", async () => {
    const accountId = await makeAccount();
    const threadId = randomUUID();
    const turn = libraryAs({ accountId, actor: { kind: "agent", threadId, turn: 1 } });
    const url = "https://pages.example/agent-saved";
    const saved = await turn.items.saveLink({ url });
    await deliver(
      { accountId, job: { coverHint: null, itemId: saved.item.id, url } },
      serveWeb({ [url]: htmlPage(blogPost) }),
    );
    await expect(fieldsIn(accountId, saved.item.id)).resolves.toMatchObject({
      reading: { state: "read" },
    });
    await sealTurnSet(db, accountId, { threadId, turn: 1 }, Date.now());
    const person = libraryAs(sessionPrincipal(accountId));
    await expect(person.agent.undo({ threadId, turn: 1 })).resolves.toMatchObject({
      kept: [],
      reverted: [saved.item.id],
    });
    const undone = await fieldsIn(accountId, saved.item.id);
    expect(undone?.deletedAt).not.toBeNull();
  });
});
