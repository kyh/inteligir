// the capture over a booted server's own vault, index and database, with the fetch, the extract
// and the clock the suite's own (capture-harness.ts): what a save writes, what its fill writes and
// when, who fills whose stubs, and what a save of a held url adds.

import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import nodePath from "node:path";

import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import { itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { classifyAddress } from "../address-guard";
import { createGuardedFetch } from "../guarded-fetch";
import { bootCapture, pngOf, START_MS } from "./capture-harness";
import type { CaptureSuite } from "./capture-harness";

const PAGE = "https://site.test/file-over-app";
const COVER = "https://site.test/cover.png";
const PAGE_HTML = [
  "<title>File over app</title>",
  '<meta property="og:site_name" content="Steph Ango">',
  `<meta property="og:image" content="${COVER}">`,
  '<meta name="description" content="Files outlive apps.">',
  "<p>Apps are ephemeral.</p>",
  "<p>Files last.</p>",
].join("\n");

const MINUTE = 60_000;

// the suite a hook built before the suite existed reads it through
interface SuiteHolder {
  suite: CaptureSuite | null;
}

const settled = async (suite: CaptureSuite, path: string, check: (content: string) => boolean) => {
  await vi.waitFor(
    () => {
      expect(
        existsSync(nodePath.join(suite.harness.vaultDir, path)) && check(suite.onDisk(path)),
      ).toBe(true);
    },
    { interval: 20, timeout: 10_000 },
  );
  return suite.onDisk(path);
};

const filled = (content: string): boolean => itemFactsOf(content).fetchedMs !== null;

const pendingRows = (suite: CaptureSuite) =>
  suite.harness.db.$client
    .prepare("SELECT item_id, path, origin, attempts, not_before FROM pending_fills")
    .all();

// a stub as a synced device would leave it, committed, so this Mac never created it
const syncedStub = async (
  suite: CaptureSuite,
  path: string,
  url: string,
  extra = "",
): Promise<void> => {
  await suite.harness.vault.service.write(
    path,
    [
      "---",
      "id: 7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
      "kind: link",
      `url: ${url}`,
      "saved: 2026-10-17T09:12:30Z",
      "---",
      extra,
    ].join("\n"),
  );
  await suite.core.commitPaths([path]);
  await suite.harness.composed.context.knowledge.settle();
};

describe("a save", () => {
  it("writes the stub at once, under the next free name, before any page is read", async () => {
    const suite = await bootCapture({ routes: { [PAGE]: { html: PAGE_HTML } } });
    await suite.harness.vault.service.write("Unsorted/site.test - file over app.md", "mine\n");
    const held = suite.fetcher.hold(PAGE);
    const saving = suite.capture.saveLink({ keepCopy: false, url: PAGE, wait: false });
    const saved = await saving;
    expect(saved).toMatchObject({
      fill: { state: "pending" },
      outcome: "created",
      path: "Unsorted/site.test - file over app 2.md",
    });
    await held.reached;
    expect(suite.onDisk("Unsorted/site.test - file over app.md")).toBe("mine\n");
    expect(itemFactsOf(suite.onDisk(saved.path)).fetchedMs).toBeNull();
    held.release();
  });

  it("makes one file for two saves of one url at once", async () => {
    const suite = await bootCapture({ routes: { [PAGE]: { html: PAGE_HTML } } });
    const [a, b] = await Promise.all([
      suite.capture.saveLink({ keepCopy: false, url: PAGE, wait: false }),
      suite.capture.saveLink({ keepCopy: false, url: `${PAGE}?utm_source=feed`, wait: false }),
    ]);
    expect([a.outcome, b.outcome].toSorted()).toEqual(["created", "exists"]);
    expect(a.path).toBe(b.path);
  });

  it("answers the full set it wrote when asked to wait: the stub, its cover and its new name", async () => {
    const suite = await bootCapture({
      routes: {
        [COVER]: { bytes: pngOf(640, 400), mediaType: "image/png" },
        [PAGE]: { html: PAGE_HTML },
      },
    });
    const saved = await suite.capture.saveLink({ keepCopy: false, url: PAGE, wait: true });
    expect(saved.fill).toEqual({ state: "filled" });
    expect(saved.path).toBe("Unsorted/File over app.md");
    const cover = saved.wrote.find((path) => path.startsWith("assets/covers/"));
    expect(cover).toMatch(/^assets\/covers\/[0-9a-f]{16}\.png$/u);
    expect(saved.wrote).toEqual(
      expect.arrayContaining([
        "Unsorted/site.test - file over app.md",
        "Unsorted/File over app.md",
      ]),
    );
    const content = suite.onDisk(saved.path);
    expect(content).toContain(`fetched: 2026-10-17T09:12:30Z`);
    expect(content).toContain("site: Steph Ango\n");
    expect(content).toContain("description: Files outlive apps.\n");
    expect(
      content.endsWith(`---\n\n![](${cover ?? ""})\n\nApps are ephemeral.\n\nFiles last.\n`),
    ).toBe(true);
    // the provisional name is no name anybody chose, so it is kept as no alias
    expect(content).not.toContain("aliases");
    expect(pendingRows(suite)).toEqual([]);
  });
});

describe("the fill", () => {
  it("keeps a person's keys and text written while the page was read", async () => {
    const suite = await bootCapture({ routes: { [PAGE]: { html: PAGE_HTML } } });
    const held = suite.fetcher.hold(PAGE);
    const saved = await suite.capture.saveLink({
      keepCopy: false,
      title: "Mine",
      url: PAGE,
      wait: false,
    });
    await held.reached;
    const stub = suite.onDisk(saved.path);
    await suite.harness.vault.service.write(
      saved.path,
      `${stub.replace("---\n", "---\npinned: true\n")}My own note.\n`.replace(
        "---\nMy own",
        "---\n\nMy own",
      ),
    );
    held.release();
    const content = await settled(suite, saved.path, filled);
    expect(content).toContain("pinned: true\n");
    expect(content).toContain("My own note.\n\nApps are ephemeral.");
    expect(saved.path).toBe("Unsorted/Mine.md");
  });

  it("renames only this Mac's untracked stub still named after its url, before it writes", async () => {
    const rowsAtPlacement: unknown[] = [];
    const holder: SuiteHolder = { suite: null };
    const suite = await bootCapture({
      onPlace: () => {
        if (holder.suite !== null) {
          rowsAtPlacement.push(...pendingRows(holder.suite));
        }
      },
      routes: { [PAGE]: { html: PAGE_HTML } },
    });
    holder.suite = suite;
    const saved = await suite.capture.saveLink({ keepCopy: false, url: PAGE, wait: true });
    expect(saved.path).toBe("Unsorted/File over app.md");
    expect(
      existsSync(nodePath.join(suite.harness.vaultDir, "Unsorted/site.test - file over app.md")),
    ).toBe(false);
    // the placement runs inside the write, so the item, and its pending row, had already moved
    expect(suite.placements.map((placement) => placement.path)).toEqual([
      "Unsorted/File over app.md",
    ]);
    expect(rowsAtPlacement).toMatchObject([{ path: "Unsorted/File over app.md" }]);

    const tracked = "https://site.test/tracked";
    suite.fetcher.routes.set(tracked, { html: "<title>A real title</title><p>Text.</p>" });
    const held = suite.fetcher.hold(tracked);
    const stub = await suite.capture.saveLink({ keepCopy: false, url: tracked, wait: false });
    await held.reached;
    await suite.core.commitPaths([stub.path]);
    held.release();
    await settled(suite, stub.path, filled);
    expect(stub.path).toBe("Unsorted/site.test - tracked.md");

    const named = "https://site.test/named";
    suite.fetcher.routes.set(named, { html: "<title>The page's title</title><p>Text.</p>" });
    const titled = await suite.capture.saveLink({
      keepCopy: false,
      title: "My name",
      url: named,
      wait: true,
    });
    expect(titled.path).toBe("Unsorted/My name.md");
  });

  it("says a failure in the file and places the waiting highlights under Highlights", async () => {
    const dead = "https://site.test/dead";
    const suite = await bootCapture();
    const saved = await suite.capture.savePage({
      keepCopy: false,
      page: { html: null, selection: { text: "a passage" }, title: "Dead page", url: dead },
      wait: true,
    });
    expect(saved.fill).toEqual({ message: "The site answered 404 (not found).", state: "failed" });
    const content = suite.onDisk(saved.path);
    expect(content).toContain(
      "fetched: 2026-10-17T09:12:30Z\nfetch-error: The site answered 404 (not found).\n",
    );
    expect(content).toContain("## Highlights\n\n> a passage\n");
    expect(suite.placements.at(-1)).toMatchObject({ final: true, path: saved.path });
  });

  it("tries a transient failure again later, and a restarted server fills what was pending", async () => {
    const flaky = "https://site.test/flaky";
    const suite = await bootCapture({
      routes: { [flaky]: { failure: { kind: "timeout" } } },
    });
    const saved = await suite.capture.saveLink({ keepCopy: false, url: flaky, wait: true });
    expect(saved.fill).toEqual({ state: "pending" });
    expect(pendingRows(suite)).toMatchObject([{ attempts: 1, not_before: START_MS + MINUTE }]);
    await suite.capture.dispose();
    suite.fetcher.routes.set(flaky, { html: "<p>Here again.</p>" });
    const next = suite.restart();
    next.boot();
    await suite.clock.advance(MINUTE);
    const content = await settled(suite, saved.path, filled);
    expect(content).toContain("Here again.");
    await vi.waitFor(() => {
      expect(pendingRows(suite)).toEqual([]);
    });
  });

  it("writes the fourth transient failure in the file", async () => {
    const flaky = "https://site.test/flaky";
    const suite = await bootCapture({ routes: { [flaky]: { failure: { kind: "timeout" } } } });
    const saved = await suite.capture.saveLink({ keepCopy: false, url: flaky, wait: true });
    for (const [attempts, wait] of [
      [2, MINUTE],
      [3, 10 * MINUTE],
    ] as const) {
      await suite.clock.advance(wait);
      await vi.waitFor(() => {
        expect(pendingRows(suite)).toMatchObject([{ attempts }]);
      });
    }
    await suite.clock.advance(60 * MINUTE);
    const content = await settled(suite, saved.path, filled);
    expect(content).toContain("fetch-error: The page took too long to answer.\n");
    expect(suite.fetcher.requests.filter((url) => url === flaky)).toHaveLength(4);
  });

  it("uses an import's cover hint when the page names none, and on a dead link", async () => {
    const hint = "https://cdn.test/raindrop-cover.png";
    const plain = "https://site.test/plain";
    const suite = await bootCapture({
      routes: {
        [hint]: { bytes: pngOf(800, 600, 7), mediaType: "image/png" },
        [plain]: { html: "<title>Plain</title><p>No picture here.</p>" },
      },
    });
    const write = async (url: string, stem: string) => {
      const { path } = await suite.core.createDoc({
        content: `---\nid: ${suite.core.newId()}\nkind: link\nurl: ${url}\nsaved: 2026-10-17T09:12:30Z\n---\n`,
        folder: "Imported",
        stem,
      });
      return path;
    };
    const living = await write(plain, "Plain");
    const dead = await write("https://site.test/gone", "Gone");
    suite.capture.enqueue(
      { id: frontmatterId(suite.onDisk(living)) ?? "", path: living, url: plain },
      { cover: hint },
    );
    suite.capture.enqueue(
      { id: frontmatterId(suite.onDisk(dead)) ?? "", path: dead, url: "https://site.test/gone" },
      { cover: hint },
    );
    for (const path of [living, dead]) {
      const content = await settled(suite, path, filled);
      expect(content).toMatch(/---\n\n!\[\]\(assets\/covers\/[0-9a-f]{16}\.png\)\n/u);
    }
    expect(suite.onDisk(dead)).toContain("fetch-error: The site answered 404 (not found).\n");
  });

  it("says a file past the limit by the size its site declared", async () => {
    const report = "https://site.test/reports/annual.pdf";
    const pdf = new TextEncoder().encode("%PDF-1.7\n%\u00E2\u00E3\n1 0 obj\n");
    const suite = await bootCapture({
      routes: {
        [report]: {
          bytes: pdf,
          declaredBytes: 24 * 1024 * 1024,
          mediaType: "application/pdf",
          truncated: true,
        },
      },
    });
    const saved = await suite.capture.saveLink({ keepCopy: false, url: report, wait: true });
    expect(saved.fill).toEqual({
      message: "The file is 24 MB; only its link is kept (the limit is 10 MB).",
      state: "failed",
    });
    suite.fetcher.routes.set(report, { bytes: pdf, mediaType: "application/pdf", truncated: true });
    const unsized = await suite.capture.refresh({
      keepCopy: false,
      path: saved.path,
      text: "keep",
      wait: true,
    });
    expect(unsized.fill).toEqual({
      message: "The file is over 10 MB; only its link is kept.",
      state: "failed",
    });
  });

  it("makes a link to a picture the picture's item", async () => {
    const picture = "https://site.test/photos/sunset.jpeg";
    const suite = await bootCapture({
      routes: { [picture]: { bytes: pngOf(1200, 800), mediaType: "image/png" } },
    });
    const saved = await suite.capture.saveLink({ keepCopy: false, url: picture, wait: true });
    const content = suite.onDisk(saved.path);
    expect(content).toContain("kind: image\n");
    expect(content).toContain("![](assets/sunset.png)\n");
    expect(existsSync(nodePath.join(suite.harness.vaultDir, "assets/sunset.png"))).toBe(true);
  });
});

describe("whose stubs this Mac fills", () => {
  it("fills another Mac's stub after fifteen minutes, syncing before and after", async () => {
    const synced: string[] = [];
    const committed: string[][] = [];
    const suite = await bootCapture({
      core: (core) => ({
        ...core,
        commitPaths: async (paths) => {
          committed.push([...paths]);
          await core.commitPaths(paths);
        },
        syncsWithAccount: async () => await Promise.resolve(true),
        syncNow: async () => {
          synced.push("sync");
          await Promise.resolve();
        },
      }),
      routes: { [PAGE]: { html: PAGE_HTML } },
    });
    await syncedStub(suite, "Unsorted/Elsewhere.md", PAGE);
    suite.capture.boot();
    await suite.clock.advance(10_000);
    await vi.waitFor(
      () => {
        expect(pendingRows(suite)).toMatchObject([
          { origin: "foreign", path: "Unsorted/Elsewhere.md" },
        ]);
      },
      { timeout: 10_000 },
    );
    await suite.clock.advance(14 * MINUTE);
    expect(suite.fetcher.requests).toEqual([]);
    await suite.clock.advance(MINUTE);
    const content = await settled(suite, "Unsorted/Elsewhere.md", filled);
    expect(content).toContain("Apps are ephemeral.");
    // the commit and the second pass follow the write
    await vi.waitFor(() => {
      expect(synced.length).toBeGreaterThanOrEqual(2);
      expect(committed.at(-1)).toContain("Unsorted/Elsewhere.md");
    });
  });

  it("makes the copy asked for of another Mac's stub at once, even when another device filled it first", async () => {
    let fillElsewhere = false;
    const suite = await bootCapture({
      core: (core) => ({
        ...core,
        syncsWithAccount: async () => await Promise.resolve(true),
        syncNow: async () => {
          if (fillElsewhere) {
            fillElsewhere = false;
            const current = await core.read("Unsorted/Elsewhere.md");
            await core.write(
              "Unsorted/Elsewhere.md",
              `${(current?.content ?? "").replace("saved:", "fetched: 2026-10-17T09:13:00Z\nsaved:")}Read on another Mac.\n`,
              current?.hash ?? "",
            );
          }
        },
      }),
    });
    await syncedStub(suite, "Unsorted/Elsewhere.md", PAGE);
    suite.capture.boot();
    await suite.clock.advance(10_000);
    await vi.waitFor(
      () => {
        expect(pendingRows(suite)).toMatchObject([{ origin: "foreign" }]);
      },
      { timeout: 10_000 },
    );
    fillElsewhere = true;
    const again = await suite.capture.savePage({
      keepCopy: true,
      page: { html: PAGE_HTML, selection: null, title: "File over app", url: PAGE },
      wait: true,
    });
    expect(again.outcome).toBe("exists");
    const content = suite.onDisk("Unsorted/Elsewhere.md");
    expect(content).toContain("Read on another Mac.");
    expect(content).toMatch(/\[Copy of the page\]\(assets\/pages\/[0-9a-f]{16}\.html\)/u);
    // the copy came from the page the browser handed over, not a fetch, and not 15 minutes on
    expect(suite.fetcher.requests).not.toContain(PAGE);
    expect(pendingRows(suite)).toEqual([]);
  });

  it("fills a phone's stub within a minute, and drops one another device filled meanwhile", async () => {
    let fillElsewhere = false;
    const suite = await bootCapture({
      core: (core) => ({
        ...core,
        creatorOf: async () => await Promise.resolve("phone" as const),
        syncsWithAccount: async () => await Promise.resolve(true),
        syncNow: async () => {
          if (fillElsewhere) {
            const current = await core.read("Unsorted/From phone 2.md");
            const content = current?.content ?? "";
            await core.write(
              "Unsorted/From phone 2.md",
              content.replace("saved:", "fetched: 2026-10-17T09:13:00Z\nsaved:"),
              current?.hash ?? "",
            );
          }
        },
      }),
      routes: { [PAGE]: { html: PAGE_HTML } },
    });
    await syncedStub(suite, "Unsorted/From phone.md", PAGE);
    suite.capture.boot();
    await suite.clock.advance(10_000 + MINUTE);
    await settled(suite, "Unsorted/From phone.md", filled);
    // the row goes once the write has returned, a moment after the file is in place
    await vi.waitFor(() => {
      expect(pendingRows(suite)).toEqual([]);
    });
    // the person's own phone saved it, so its own address decides what it may reach
    expect(suite.fetcher.reaches).toContainEqual({ reach: null, url: PAGE });

    const other = "https://site.test/other";
    await suite.harness.vault.service.write(
      "Unsorted/From phone 2.md",
      `---\nid: 11111111-2222-4333-8444-555555555555\nkind: link\nurl: ${other}\nsaved: 2026-10-17T09:12:30Z\n---\n`,
    );
    await suite.harness.composed.context.knowledge.settle();
    fillElsewhere = true;
    await suite.clock.advance(MINUTE + 10_000);
    await settled(suite, "Unsorted/From phone 2.md", filled);
    await vi.waitFor(() => {
      expect(pendingRows(suite)).toEqual([]);
    });
    expect(suite.fetcher.requests).not.toContain(other);
  });

  it("never lets another device's stub lead this Mac into private space", async () => {
    const router = "http://192.168.1.1/cgi-bin/luci";
    const suite = await bootCapture({
      core: (core) => ({
        ...core,
        syncsWithAccount: async () => await Promise.resolve(true),
      }),
      routes: { [router]: { html: "<title>Router</title><p>Admin.</p>" } },
    });
    await syncedStub(suite, "Unsorted/Router.md", router);
    suite.capture.boot();
    await suite.clock.advance(10_000 + 15 * MINUTE);
    const content = await settled(suite, "Unsorted/Router.md", filled);
    expect(content).toContain(
      "fetch-error: The page pointed at an address on your own network, so it isn't read.\n",
    );
    expect(content).not.toContain("Admin.");
    expect(suite.fetcher.reaches).toEqual([{ reach: "public", url: router }]);
  });

  it("fills no other device's stub, a phone's included, in a library that does not sync with the account", async () => {
    const suite = await bootCapture({
      core: (core) => ({
        ...core,
        creatorOf: async () => await Promise.resolve("phone" as const),
      }),
      routes: { [PAGE]: { html: PAGE_HTML } },
    });
    expect(await suite.core.syncsWithAccount()).toBe(false);
    await syncedStub(suite, "Unsorted/Their stub.md", PAGE);
    suite.capture.boot();
    await suite.clock.advance(20 * MINUTE);
    expect(suite.fetcher.requests).toEqual([]);
    expect(pendingRows(suite)).toEqual([]);
  });

  it("never fills a link note an opened folder already held", async () => {
    const suite = await bootCapture({ routes: { [PAGE]: { html: PAGE_HTML } } });
    await suite.harness.vault.service.write(
      "Theirs.md",
      `---\nkind: link\nurl: ${PAGE}\n---\nMy note.\n`,
    );
    await suite.harness.composed.context.knowledge.settle();
    suite.capture.boot();
    await suite.clock.advance(20 * MINUTE);
    expect(suite.fetcher.requests).toEqual([]);
    expect(pendingRows(suite)).toEqual([]);
  });

  it("folds a stub into the item already holding its url instead of reading the page", async () => {
    const suite = await bootCapture({
      core: (core) => ({
        ...core,
        syncsWithAccount: async () => await Promise.resolve(true),
      }),
      routes: { [PAGE]: { html: PAGE_HTML } },
    });
    await suite.harness.vault.service.write(
      "Reading/File over app.md",
      `---\nid: 0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11\nkind: link\nurl: ${PAGE}\nsaved: 2026-10-16T09:00:00Z\nfetched: 2026-10-16T09:00:05Z\n---\n\n![](assets/covers/abc.png)\n\nThe article.\n`,
    );
    await syncedStub(suite, "Unsorted/Duplicate.md", PAGE, "\nFor Tuesday.\n");
    await suite.harness.vault.service.write(
      "Unsorted/Duplicate.md",
      suite.onDisk("Unsorted/Duplicate.md").replace("saved:", "tags:\n  - later\nsaved:"),
    );
    await suite.harness.composed.context.knowledge.settle();
    suite.capture.boot();
    await suite.clock.advance(10_000 + 15 * MINUTE);
    await vi.waitFor(() => {
      expect(existsSync(nodePath.join(suite.harness.vaultDir, "Unsorted/Duplicate.md"))).toBe(
        false,
      );
    });
    const holder = suite.onDisk("Reading/File over app.md");
    expect(holder).toContain("tags:\n  - later\n");
    expect(holder).toContain("![](assets/covers/abc.png)\n\nFor Tuesday.\n\nThe article.\n");
    expect(suite.fetcher.requests).toEqual([]);
  });
});

describe("what a fill may reach", () => {
  it("keeps a public page's cover, stylesheets and pictures out of private space", async () => {
    const mixed = "https://site.test/mixed";
    const privateCover = "http://192.168.1.1/admin.png";
    const privateSheet = "http://10.0.0.5/style.css";
    const privatePicture = "http://192.168.1.1/picture.png";
    const suite = await bootCapture({
      routes: {
        [mixed]: {
          html: [
            "<title>Mixed</title>",
            `<meta property="og:image" content="${privateCover}">`,
            `<link rel="stylesheet" href="${privateSheet}">`,
            `<img src="${privatePicture}">`,
            "<p>Public words.</p>",
          ].join("\n"),
        },
        [privateCover]: { bytes: pngOf(640, 400), mediaType: "image/png" },
        [privatePicture]: { bytes: pngOf(640, 400, 3), mediaType: "image/png" },
        [privateSheet]: { bytes: new TextEncoder().encode("p{}"), mediaType: "text/css" },
      },
    });
    const saved = await suite.capture.saveLink({ keepCopy: true, url: mixed, wait: true });
    expect(saved.fill).toEqual({ state: "filled" });
    expect(saved.wrote.some((path) => path.startsWith("assets/covers/"))).toBe(false);
    expect(suite.fetcher.reaches[0]).toEqual({ reach: null, url: mixed });
    const subresources = suite.fetcher.reaches.slice(1);
    expect(subresources.map((request) => request.url).toSorted()).toEqual(
      [privateCover, privatePicture, privateSheet].toSorted(),
    );
    expect(subresources.every((request) => request.reach === "public")).toBe(true);
  });

  it("lets a page on the person's own network keep a cover from that network", async () => {
    const lan = "http://192.168.1.10/notes";
    const lanCover = "http://192.168.1.10/cover.png";
    const suite = await bootCapture({
      routes: {
        [lan]: {
          html: `<title>Home</title><meta property="og:image" content="${lanCover}"><p>Words.</p>`,
        },
        [lanCover]: { bytes: pngOf(640, 400), mediaType: "image/png" },
      },
    });
    const saved = await suite.capture.saveLink({ keepCopy: false, url: lan, wait: true });
    expect(saved.wrote.some((path) => path.startsWith("assets/covers/"))).toBe(true);
    expect(suite.fetcher.reaches).toEqual([
      { reach: null, url: lan },
      { reach: "private", url: lanCover },
    ]);
  });
});

describe("a refresh", () => {
  it("keeps a read item as it was when the page can't be read again, so the next adds the article once", async () => {
    const suite = await bootCapture({ routes: { [PAGE]: { html: PAGE_HTML } } });
    const first = await suite.capture.saveLink({ keepCopy: false, url: PAGE, wait: true });
    const before = suite.onDisk(first.path);
    suite.fetcher.routes.set(PAGE, { failure: { kind: "unreachable", transient: true } });
    const failed = await suite.capture.refresh({
      keepCopy: false,
      path: first.path,
      text: "keep",
      wait: true,
    });
    expect(failed.fill).toEqual({ message: "The page couldn't be reached.", state: "failed" });
    expect(suite.onDisk(first.path)).toBe(before);
    suite.fetcher.routes.set(PAGE, { html: PAGE_HTML });
    await suite.capture.refresh({ keepCopy: true, path: first.path, text: "keep", wait: true });
    const after = suite.onDisk(first.path);
    expect(after.split("Apps are ephemeral.")).toHaveLength(2);
    expect(after).toMatch(/\[Copy of the page\]\(assets\/pages\/[0-9a-f]{16}\.html\)/u);
  });
});

describe("a highlight taken out of a read item's text", () => {
  it("stays out through a refresh and a copy of the page", async () => {
    const suite = await bootCapture({ routes: { [PAGE]: { html: PAGE_HTML } } });
    const first = await suite.capture.saveLink({ keepCopy: false, url: PAGE, wait: true });
    const { annotations } = suite.harness.composed.context;
    await annotations.add({
      id: "h1",
      path: first.path,
      place: { occurrence: 1 },
      quote: "Files last.",
      source: "user",
      text: "",
    });
    // the person deletes the paragraph, and the highlight's markers with it
    const read = suite.onDisk(first.path);
    const cut = read.replace(/\n[^\n]*Files last\.[^\n]*\n/u, "\n");
    expect(cut).not.toContain("Files last.");
    await suite.harness.vault.service.write(first.path, cut);
    await suite.harness.composed.context.knowledge.settle();
    const before = suite.placements.length;
    await suite.capture.refresh({ keepCopy: false, path: first.path, text: "keep", wait: true });
    await suite.capture.refresh({ keepCopy: true, path: first.path, text: "keep", wait: true });
    expect(suite.placements.slice(before)).toEqual([]);
    const after = suite.onDisk(first.path);
    expect(after).not.toContain("## Highlights");
    expect(after).toMatch(/\[Copy of the page\]\(assets\/pages\/[0-9a-f]{16}\.html\)/u);
    const listed = await annotations.list(first.path);
    expect(listed.annotations.map((annotation) => annotation.state)).toEqual(["missing"]);
  });
});

// the queue's fill holds on the page; the person's refresh from Info reads it first
const overtaken = async (then: Parameters<CaptureSuite["fetcher"]["routes"]["set"]>[1]) => {
  const suite = await bootCapture({ routes: { [PAGE]: { html: PAGE_HTML } } });
  const held = suite.fetcher.hold(PAGE);
  const saved = await suite.capture.saveLink({ keepCopy: false, url: PAGE, wait: false });
  await held.reached;
  const refreshed = await suite.capture.refresh({
    keepCopy: false,
    path: saved.path,
    text: "keep",
    wait: true,
  });
  expect(refreshed.fill).toEqual({ state: "filled" });
  const read = suite.onDisk(refreshed.path);
  suite.fetcher.routes.set(PAGE, then);
  held.release();
  await vi.waitFor(() => {
    expect(pendingRows(suite)).toEqual([]);
  });
  return { read, refreshed, suite };
};

describe("a refresh made while the item's first fill runs", () => {
  it("keeps the item read when the first fill then fails, so the next refresh adds the article once", async () => {
    const { read, refreshed, suite } = await overtaken({
      failure: { kind: "status", reason: "not found", status: 404, transient: false },
    });
    const after = suite.onDisk(refreshed.path);
    expect(after).toBe(read);
    expect(itemFactsOf(after).fetchError).toBeNull();
    suite.fetcher.routes.set(PAGE, { html: PAGE_HTML });
    await suite.capture.refresh({
      keepCopy: false,
      path: refreshed.path,
      text: "keep",
      wait: true,
    });
    expect(suite.onDisk(refreshed.path).split("Apps are ephemeral.")).toHaveLength(2);
  });

  it("embeds no second file when the first fill then finds one at the link", async () => {
    const { read, refreshed, suite } = await overtaken({
      bytes: pngOf(640, 400),
      mediaType: "image/png",
    });
    expect(suite.onDisk(refreshed.path)).toBe(read);
    expect(itemFactsOf(read).kind).toBe("link");
    // the file it saved is taken back, since nothing embeds it
    const pictures = readdirSync(suite.harness.vaultDir, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith(".png") && !path.startsWith(".git"));
    expect(pictures).toEqual([]);
  });
});

describe("a page the browser handed over", () => {
  it("is never requested, and its selection waits for the fill that places it", async () => {
    const suite = await bootCapture();
    const saved = await suite.capture.savePage({
      keepCopy: true,
      page: {
        html: PAGE_HTML,
        selection: { text: "Files last." },
        title: "File over app",
        url: PAGE,
      },
      wait: true,
    });
    expect(saved.fill).toEqual({ state: "filled" });
    // its cover is fetched; the page itself never is
    expect(suite.fetcher.requests).not.toContain(PAGE);
    const content = suite.onDisk(saved.path);
    expect(content).toContain("fetched: 2026-10-17T09:12:30Z\n");
    expect(content).toMatch(
      /\[Copy of the page\]\(assets\/pages\/[0-9a-f]{16}\.html\)\n\n## Highlights\n\n> Files last\.\n/u,
    );
    const id = frontmatterId(content) ?? "";
    expect(suite.onDisk(annotationsStorePath(id))).toContain("Files last.");
  });

  it("never lets its name's answer now lead the cover or the copy into private space", async () => {
    // the router, on loopback, which this guard's policy reads as private space
    const seen: string[] = [];
    const router = createServer((request, response) => {
      seen.push(request.url ?? "/");
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from(pngOf(640, 400)));
    });
    router.listen(0, "127.0.0.1");
    await once(router, "listening");
    const { port } = z.object({ port: z.number() }).parse(router.address());
    const lookups: string[] = [];
    const guard = createGuardedFetch({
      acceptLanguage: "en",
      // the browser loaded evil.test from a public server; its nameserver now answers the router
      lookup: async (hostname) => {
        lookups.push(hostname);
        return await Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
      },
      ownPort: () => null,
      policy: (address) => (address === "127.0.0.1" ? "private" : classifyAddress(address)),
      userAgent: "test-agent",
    });
    const suite = await bootCapture({ fetch: guard });
    const inside = `http://127.0.0.1:${port}/cgi-bin/apply.cgi`;
    try {
      const saved = await suite.capture.savePage({
        keepCopy: true,
        page: {
          html: [
            "<title>A page</title>",
            `<meta property="og:image" content="${inside}">`,
            `<link rel="stylesheet" href="${inside}?sheet">`,
            `<img src="${inside}?picture">`,
            "<p>Text.</p>",
          ].join("\n"),
          selection: null,
          title: "A page",
          url: "https://evil.test/article",
        },
        wait: true,
      });
      expect(saved.fill).toEqual({ state: "filled" });
      expect(suite.onDisk(saved.path)).not.toContain("cover:");
      expect(lookups).toEqual([]);
      expect(seen).toEqual([]);
    } finally {
      router.closeAllConnections();
      router.close();
    }
  });
});

describe("a save of a url the library holds", () => {
  it("adds its tags, its selection and a copy of the page, leaving the text as it was", async () => {
    const suite = await bootCapture({ routes: { [PAGE]: { html: PAGE_HTML } } });
    const first = await suite.capture.saveLink({ keepCopy: false, url: PAGE, wait: true });
    await suite.harness.composed.context.knowledge.settle();
    const before = suite.onDisk(first.path);
    const again = await suite.capture.savePage({
      keepCopy: true,
      page: {
        html: PAGE_HTML,
        selection: { text: "a passage no longer there" },
        title: "",
        url: PAGE,
      },
      tags: ["essays"],
      wait: true,
    });
    expect(again.outcome).toBe("exists");
    expect(again.path).toBe(first.path);
    const after = suite.onDisk(first.path);
    expect(after).toContain("tags:\n  - essays\n");
    expect(after).toMatch(/\[Copy of the page\]\(assets\/pages\/[0-9a-f]{16}\.html\)/u);
    expect(after).toContain("## Highlights\n\n> a passage no longer there\n");
    expect(after).toContain(
      before.slice(before.indexOf("Apps are ephemeral."), before.indexOf("Files last.")),
    );
    // the copy is built from the page the browser handed over: the page is read once, by the first
    expect(suite.fetcher.requests.filter((url) => url === PAGE)).toHaveLength(1);
  });

  it("keeps a note that carries the url as the person wrote it when a copy is asked for", async () => {
    const suite = await bootCapture({ routes: { [PAGE]: { html: PAGE_HTML } } });
    const essay = `---\nurl: ${PAGE}\n---\n\nMy own essay on files.\n`;
    await suite.harness.vault.service.write("Reading/On files.md", essay);
    await suite.harness.composed.context.knowledge.settle();
    const again = await suite.capture.savePage({
      keepCopy: true,
      page: { html: PAGE_HTML, selection: null, title: "File over app", url: PAGE },
      wait: true,
    });
    expect(again).toMatchObject({ outcome: "exists", path: "Reading/On files.md" });
    expect(suite.onDisk("Reading/On files.md")).toBe(essay);
    expect(suite.fetcher.requests).toEqual([]);
  });

  it("adds a selection once when the page comes again with it still selected", async () => {
    const suite = await bootCapture({
      routes: { [COVER]: { bytes: pngOf(640, 400), mediaType: "image/png" } },
    });
    const page = {
      html: PAGE_HTML,
      selection: { text: "Files last." },
      title: "File over app",
      url: PAGE,
    };
    const first = await suite.capture.savePage({ keepCopy: false, page, wait: true });
    await suite.harness.composed.context.knowledge.settle();
    await suite.capture.savePage({ keepCopy: true, page, wait: true });
    const listed = await suite.harness.composed.context.annotations.list(first.path);
    expect(listed.annotations.map((annotation) => annotation.quote)).toEqual(["Files last."]);
  });

  it("keeps the copy asked for while the item's first fill is under way", async () => {
    const suite = await bootCapture({
      routes: { [COVER]: { bytes: pngOf(640, 400), mediaType: "image/png" } },
    });
    const page = { html: PAGE_HTML, selection: null, title: "File over app", url: PAGE };
    const held = suite.fetcher.hold(COVER);
    const first = await suite.capture.savePage({ keepCopy: false, page, wait: false });
    await held.reached;
    const asking = suite.capture.savePage({ keepCopy: true, page, wait: true });
    // the running row gains the copy once the second save reaches it
    await vi.waitFor(() => {
      expect(
        suite.harness.db.$client.prepare("SELECT keep_copy FROM pending_fills").pluck().all(),
      ).toEqual([1]);
    });
    held.release();
    const again = await asking;
    expect(again.outcome).toBe("exists");
    const content = suite.onDisk(again.path);
    expect(content).toMatch(/\[Copy of the page\]\(assets\/pages\/[0-9a-f]{16}\.html\)/u);
    expect(content.split("Apps are ephemeral.")).toHaveLength(2);
    expect(first.outcome).toBe("created");
    // the copy came from the page handed over again; the page itself was never requested
    expect(suite.fetcher.requests).not.toContain(PAGE);
  });
});

describe("the pending store", () => {
  it("is one insert per enqueued item, never a rewrite of the rows before it", async () => {
    const suite = await bootCapture();
    const held = suite.fetcher.hold("https://site.test/0");
    const changes = (): number =>
      Number(suite.harness.db.$client.prepare("SELECT total_changes() AS n").pluck().get());
    const start = changes();
    for (let index = 0; index < 8500; index += 1) {
      suite.capture.enqueue({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        path: `Imported/${String(index)}.md`,
        url: `https://site.test/${String(index)}`,
      });
    }
    expect(changes() - start).toBe(8500);
    expect(pendingRows(suite)).toHaveLength(8500);
    held.release();
  });
});
