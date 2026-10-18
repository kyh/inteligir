// saving a link on the command line against the real composition and the real fill worker, with
// only the fetch replaced by a table (no page leaves the machine): `save` reads the page and names
// the item after it, a held link answers where it is, a page that cannot be read says why and
// `item refresh` reads it again, `save -` keeps stdin's order, `--html` is never fetched, and
// `--copy` keeps a copy beside the item.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import {
  itemSaveResponseSchema,
  itemsRefreshResponseSchema,
} from "@repo/contract/local/items/items-schema";
import { describe, expect, it } from "vitest";
import { saveStdinOutputSchema } from "../commands/save";
import { bootTestApp, listenTestApp, TEST_SERVER_TOKEN } from "../server/__tests__/boot-app";
import { fakeFetcher } from "../server/items/capture/__tests__/capture-harness";
import type { Route } from "../server/items/capture/__tests__/capture-harness";
import { loopbackOrigin } from "../server/server-file";
import { FIXTURE_PAGE_PATH } from "./command-tree";
import { runCliForTest } from "./run-cli";
import type { RunArgs } from "./run-cli";

const ARTICLE_URL = "https://capture.test/essays/file-over-app";
const COVER_URL = "https://capture.test/cover.png";

const pageOf = (title: string, paragraphs: readonly string[], head = ""): string =>
  [
    "<!doctype html>",
    '<html lang="en"><head>',
    `<title>${title}</title>`,
    '<meta property="og:site_name" content="Capture Test">',
    '<meta name="description" content="A page the suite serves itself.">',
    head,
    "</head><body><article>",
    `<h1>${title}</h1>`,
    ...paragraphs.map((paragraph) => `<p>${paragraph}</p>`),
    "</article></body></html>",
  ].join("\n");

const ARTICLE = pageOf(
  "File over app",
  [
    "If you want to create digital artifacts that last, they must be files you can control.",
    "Apps are ephemeral, and the files they write outlast every one of them.",
  ],
  `<meta property="og:image" content="${COVER_URL}">`,
);

// a chunk of a PNG: its length, its type, its body and the CRC over the type and the body
const pngChunk = (type: string, body: Uint8Array): Buffer => {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const framed = Buffer.alloc(typed.length + 8);
  framed.writeUInt32BE(body.length, 0);
  framed.set(typed, 4);
  framed.writeUInt32BE(crc32(typed), typed.length + 4);
  return framed;
};

// a whole PNG of one opaque grey, decodable to its last byte: this suite's server downscales with
// the platform's own tool, on macOS `sips`, which decodes the picture and answers nothing for a
// header alone; at 640 px it is within the cover's edge, so every platform keeps it as it is, a PNG
const solidPng = (width: number, height: number): Uint8Array => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // eight bits a channel, RGB, the standard compression and filter methods, not interlaced
  header.set([8, 2, 0, 0, 0], 8);
  // each scanline is its filter byte (none) and the row's RGB samples
  const scanline = Buffer.alloc(1 + width * 3, 0x80);
  scanline[0] = 0;
  const pixels = Buffer.concat(Array.from({ length: height }, () => scanline));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(pixels)),
      pngChunk("IEND", new Uint8Array(0)),
    ]),
  );
};

const bootCli = async (routes: Record<string, Route>) => {
  const fetcher = fakeFetcher(routes);
  const booted = await bootTestApp({ items: { fetcher } });
  const { port } = await listenTestApp(booted);
  const baseUrl = loopbackOrigin(port);
  const cli = async (argv: string[], stdin?: Uint8Array) => {
    const args: RunArgs = { argv, baseUrl, token: TEST_SERVER_TOKEN };
    if (stdin !== undefined) {
      args.stdin = stdin;
    }
    return await runCliForTest(args);
  };
  const onDisk = (vaultPath: string): string | null => {
    const absolute = path.join(booted.vaultDir, vaultPath);
    return existsSync(absolute) ? readFileSync(absolute, "utf-8") : null;
  };
  return { booted, cli, fetcher, onDisk };
};

const bodyOf = (content: string | null): string =>
  content?.split("\n---\n").slice(1).join("") ?? "";

describe("save on the command line", { timeout: 120_000 }, () => {
  it("reads the page, names the item after it with its cover first, and answers a held link", async () => {
    const { cli, onDisk } = await bootCli({
      [ARTICLE_URL]: { html: ARTICLE },
      [COVER_URL]: { bytes: solidPng(640, 400), mediaType: "image/png" },
    });

    const saved = await cli(["save", `${ARTICLE_URL}?utm_source=feed`, "--json"]);
    expect(saved.code).toBe(0);
    const answer = itemSaveResponseSchema.parse(JSON.parse(saved.stdout));
    expect(answer).toMatchObject({
      fill: { state: "filled" },
      outcome: "created",
      path: "Unsorted/File over app.md",
    });
    const content = onDisk(answer.path) ?? "";
    expect(content).toContain(`url: ${ARTICLE_URL}\n`);
    expect(content).toContain("kind: link\n");
    expect(content).toContain("site: Capture Test\n");
    expect(content).toContain("description: A page the suite serves itself.\n");
    expect(content).toMatch(/\nsaved: \S+\n/u);
    expect(content).toMatch(/\nfetched: \S+\n/u);
    expect(bodyOf(content)).toMatch(/^\n!\[\]\(assets\/covers\/[0-9a-f]{16}\.png\)\n\n/u);
    expect(bodyOf(content)).toContain("Apps are ephemeral, and the files they write outlast");

    const again = await cli(["save", ARTICLE_URL]);
    expect(again.stdout).toBe("Already saved: Unsorted/File over app.md\n");
    const againJson = await cli(["save", ARTICLE_URL, "--json"]);
    expect(itemSaveResponseSchema.parse(JSON.parse(againJson.stdout)).outcome).toBe("exists");
  });

  it("says why a page could not be read, and item refresh reads it once it answers", async () => {
    const gone = "https://capture.test/later";
    const { cli, fetcher, onDisk } = await bootCli({});

    const saved = await cli(["save", gone]);
    expect(saved.code).toBe(0);
    expect(saved.stdout).toBe(
      "Saved Unsorted/capture.test - later.md, but its page couldn't be read: " +
        "The site answered 404 (not found).\n",
    );
    expect(onDisk("Unsorted/capture.test - later.md")).toContain(
      "fetch-error: The site answered 404 (not found).\n",
    );

    fetcher.routes.set(gone, { html: pageOf("Later", ["The page answers now, a day on."]) });
    const refreshed = await cli(["item", "refresh", "Unsorted/capture.test - later.md", "--json"]);
    expect(refreshed.code).toBe(0);
    expect(itemsRefreshResponseSchema.parse(JSON.parse(refreshed.stdout)).fill).toEqual({
      state: "filled",
    });
    const content = onDisk("Unsorted/capture.test - later.md") ?? "";
    expect(content).not.toContain("fetch-error");
    expect(content).toContain("The page answers now, a day on.");

    const pending = await cli(["save", "https://capture.test/unread", "--no-wait", "--json"]);
    expect(itemSaveResponseSchema.parse(JSON.parse(pending.stdout)).fill).toEqual({
      state: "pending",
    });
  });

  it("saves every link on stdin in order", async () => {
    const first = "https://capture.test/first";
    const second = "https://capture.test/second";
    const { cli } = await bootCli({
      [first]: { html: pageOf("The first page", ["The first page's own paragraph of text."]) },
      [second]: { html: pageOf("The second page", ["The second page's own paragraph of text."]) },
    });
    const saved = await cli(
      ["save", "-", "--json"],
      new TextEncoder().encode(`${first}\n\n${second}\n`),
    );
    expect(saved.code).toBe(0);
    const { results } = saveStdinOutputSchema.parse(JSON.parse(saved.stdout));
    expect(results.map((result) => [result.outcome, result.path])).toEqual([
      ["created", "Unsorted/The first page.md"],
      ["created", "Unsorted/The second page.md"],
    ]);
  });

  it("files the page it is handed without fetching it, and keeps a copy when asked", async () => {
    const given = "https://capture.test/given";
    const { cli, fetcher, onDisk } = await bootCli({ [ARTICLE_URL]: { html: ARTICLE } });

    const handed = await cli(["save", given, "--html", FIXTURE_PAGE_PATH, "--json"]);
    expect(handed.code).toBe(0);
    const handedPath = itemSaveResponseSchema.parse(JSON.parse(handed.stdout)).path;
    expect(handedPath).toBe("Unsorted/File over app.md");
    expect(onDisk(handedPath)).toContain("Files outlast apps.");
    expect(fetcher.requests).not.toContain(given);

    const copied = await cli(["save", ARTICLE_URL, "--copy", "--folder", "Reading", "--json"]);
    expect(copied.code).toBe(0);
    const copiedPath = itemSaveResponseSchema.parse(JSON.parse(copied.stdout)).path;
    const link = /\[Copy of the page\]\((?<copy>assets\/pages\/[0-9a-f]{16}\.html)\)/u.exec(
      onDisk(copiedPath) ?? "",
    )?.groups?.copy;
    expect(link).toBeDefined();
    const copy = onDisk(link ?? "") ?? "";
    expect(copy).toContain(`<!-- Saved by inteligir from ${ARTICLE_URL} on `);
    expect(copy).not.toContain("<script");
  });
});
