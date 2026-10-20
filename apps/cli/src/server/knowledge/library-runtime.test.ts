import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ItemQuery } from "@repo/notes/items/library-index";
import { KNOWLEDGE_SCHEMA_VERSION } from "@repo/notes/knowledge/sql-knowledge-store";
import { createSqliteDriver } from "./sqlite-driver";
import { bootIndexedVault, makeVaultDirs } from "./test-support/indexed-vault";

const makeDirs = () => makeVaultDirs("inteligir-library-runtime-");

const PAGE: ItemQuery = { limit: 100, offset: 0, sort: "saved", subfolders: true, untagged: false };

const SECOND = 1000;
const T0 = Date.UTC(2026, 9, 1) / SECOND;

const linkItem = (url: string, saved: string): string =>
  `---\nid: i-${saved}\nkind: link\nurl: ${url}\nsaved: ${saved}\n---\n`;

describe("the library over the runtime", () => {
  it("lists items by the listing's mtimes, a bare file with its size", async () => {
    const dirs = makeDirs();
    mkdirSync(nodePath.join(dirs.root, "notes"), { recursive: true });
    for (const [name, age] of [
      ["notes/old.md", 3],
      ["notes/new.md", 1],
      ["scan.pdf", 2],
    ] as const) {
      const file = nodePath.join(dirs.root, name);
      writeFileSync(file, name.endsWith(".md") ? `# ${name}\n` : "%PDF-1.4");
      utimesSync(file, T0 - age * 3600, T0 - age * 3600);
    }
    const { knowledge } = bootIndexedVault(dirs);
    const page = await knowledge.items({ ...PAGE, sort: "modified" });
    expect(page.items.map((row) => row.path)).toEqual(["notes/new.md", "scan.pdf", "notes/old.md"]);
    expect(page.items[1]).toMatchObject({ bare: true, fileBytes: 8, kind: "pdf" });
    expect(page.items[0]?.modifiedMs).toBe((T0 - 3600) * SECOND);
    const scopes = await knowledge.scopes();
    expect(scopes.folders).toEqual([{ items: 2, path: "notes" }]);
  });

  it("finds a saved url by any spelling once its write settles", async () => {
    const { knowledge, service } = bootIndexedVault(makeDirs());
    await service.write(
      "Unsorted/File over app.md",
      linkItem("https://stephango.com/file-over-app?utm_source=share", "2026-10-17T09:12:30Z"),
    );
    const found = await knowledge.findByUrl("https://www.stephango.com/file-over-app/", 10);
    expect(found).toMatchObject({ key: "stephango.com/file-over-app" });
    expect(found.items.map((row) => row.path)).toEqual(["Unsorted/File over app.md"]);
    expect(await knowledge.itemsAt(["Unsorted/File over app.md", "missing.md"])).toHaveLength(1);
  });

  it("names the files that are not docs a doc links", async () => {
    const { knowledge, service } = bootIndexedVault(makeDirs());
    await service.writeAsset("assets", "pic.png", new Uint8Array([1, 2, 3]));
    await service.write("a.md", "![](assets/pic.png) [[b]] ![](assets/pic.png) [x](gone.png)\n");
    await service.write("b.md", "# B\n");
    expect(await knowledge.linkedFiles("a.md")).toEqual(["assets/pic.png"]);
  });

  it("does not read a doc again whose size and mtime did not move", async () => {
    const dirs = makeDirs();
    for (const name of ["a.md", "b.md", "c.md"]) {
      writeFileSync(nodePath.join(dirs.root, name), `# ${name}\n\nquokka\n`);
    }
    const first = bootIndexedVault(dirs);
    await first.knowledge.settle();
    expect(first.knowledge.lastReconcile).toMatchObject({ projected: 3, unchanged: 0 });
    await first.knowledge.dispose();

    let reads = 0;
    const second = bootIndexedVault(dirs, {
      reader: (service) => ({
        ...service,
        readBytes: async (path, lane) => {
          reads += 1;
          return await service.readBytes(path, lane);
        },
      }),
    });
    await second.knowledge.settle();
    expect(reads).toBe(0);
    expect(second.knowledge.lastReconcile).toMatchObject({ projected: 0, unchanged: 3 });
    const hits = await second.knowledge.search({ limit: 10, query: "quokka" });
    expect(hits).toHaveLength(3);
    await second.knowledge.dispose();

    // a touch keeps the bytes: one read, no projection, and the next boot reads nothing
    utimesSync(nodePath.join(dirs.root, "b.md"), T0, T0);
    writeFileSync(nodePath.join(dirs.root, "c.md"), "# c.md\n\nwombat\n");
    reads = 0;
    const third = bootIndexedVault(dirs, {
      reader: (service) => ({
        ...service,
        readBytes: async (path, lane) => {
          reads += 1;
          return await service.readBytes(path, lane);
        },
      }),
    });
    await third.knowledge.settle();
    expect(reads).toBe(2);
    expect(third.knowledge.lastReconcile).toMatchObject({ projected: 1, unchanged: 2 });
    await third.knowledge.dispose();

    reads = 0;
    const fourth = bootIndexedVault(dirs, {
      reader: (service) => ({
        ...service,
        readBytes: async (path, lane) => {
          reads += 1;
          return await service.readBytes(path, lane);
        },
      }),
    });
    await fourth.knowledge.settle();
    expect(reads).toBe(0);
  });

  it("wipes and rebuilds an index left at another schema version", async () => {
    const dirs = makeDirs();
    writeFileSync(nodePath.join(dirs.root, "a.md"), "# A\n\nquokka\n");
    const old = createSqliteDriver(nodePath.join(dirs.dataDir, "knowledge.db"));
    old.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
    old.exec(`PRAGMA user_version = ${String(KNOWLEDGE_SCHEMA_VERSION - 1)}`);
    old.close();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      /* empty */
    });
    try {
      const { knowledge } = bootIndexedVault(dirs);
      await knowledge.settle();
      expect(warn).toHaveBeenCalledWith(
        "[knowledge] discarding the index db (will rebuild):",
        expect.stringContaining(`schema version ${String(KNOWLEDGE_SCHEMA_VERSION - 1)}`),
      );
      expect(knowledge.lastReconcile).toMatchObject({ projected: 1 });
    } finally {
      warn.mockRestore();
    }
  });

  it("answers scopes from the walk it keeps, walking again only for a folder change", async () => {
    const dirs = makeDirs();
    mkdirSync(nodePath.join(dirs.root, "Reading", "empty"), { recursive: true });
    writeFileSync(nodePath.join(dirs.root, "Reading", "a.md"), "# A\n");
    let dirWalks = 0;
    const { knowledge, service } = bootIndexedVault(dirs, {
      reader: (inner) => ({
        ...inner,
        listDirs: async (under) => {
          dirWalks += 1;
          return await inner.listDirs(under);
        },
      }),
    });
    await knowledge.settle();
    const booted = dirWalks;
    for (let call = 0; call < 100; call += 1) {
      await knowledge.scopes();
    }
    expect(dirWalks).toBe(booted);
    const before = await knowledge.scopes();
    expect(before.folders).toEqual([
      { items: 1, path: "Reading" },
      { items: 0, path: "Reading/empty" },
    ]);

    await service.createDir("Later/inner");
    const after = await knowledge.scopes();
    expect(dirWalks).toBe(booted + 1);
    expect(after.folders.map((folder) => folder.path)).toEqual([
      "Later",
      "Later/inner",
      "Reading",
      "Reading/empty",
    ]);
    await service.remove("Reading/empty");
    const removed = await knowledge.scopes();
    expect(removed.folders.map((folder) => folder.path)).toEqual([
      "Later",
      "Later/inner",
      "Reading",
    ]);
  });

  it("says targets-changed for a rename, an alias, pin or heading edit, never another body edit", async () => {
    let changed = 0;
    const { knowledge, service } = bootIndexedVault(makeDirs(), {
      onTargetsChanged: () => {
        changed += 1;
      },
    });
    await service.write("a.md", "# A\n");
    await knowledge.settle();
    changed = 0;

    await service.write("a.md", "# A\n\nA longer body.\n");
    await knowledge.settle();
    expect(changed).toBe(0);

    await service.rename("a.md", "b.md");
    await knowledge.settle();
    expect(changed).toBe(1);

    await service.write("b.md", "---\naliases: [Alpha]\n---\n# A\n");
    await knowledge.settle();
    expect(changed).toBe(2);

    // a pin or a heading the targets rows carry moves the page's pinned set and link titles
    await service.write("b.md", "---\naliases: [Alpha]\npinned: true\n---\n# A\n");
    await knowledge.settle();
    expect(changed).toBe(3);
    const targets = await knowledge.wikiTargets();
    expect(targets.find((target) => target.path === "b.md")?.pinned).toBe(true);
    await service.write("b.md", "---\naliases: [Alpha]\npinned: true\n---\n# Beta\n");
    await knowledge.settle();
    expect(changed).toBe(4);
  });
});
