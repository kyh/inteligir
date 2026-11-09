// Imports as the cell runs them: a file the device uploaded, read by the alarm a page at a time
// into one change set, an address the library holds counted rather than saved twice; a run cut off
// by an eviction resumes where it stood; a zip of notes, Obsidian's way included, read with its
// links, its files and its folders.

import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { FOLDER_NAME_MAX } from "@repo/contract/library/library-wire";
import { RAINDROP_EXPORT } from "../imports/test-support/raindrop-export";
import { libraryIn, pngOf } from "../fill/test-support/fill-cell";
import {
  ended,
  importJobOf as jobOf,
  jobHostIn,
  runAlarmsUntil,
  runImportToEnd as runToEnd,
  runImportsOnce as runOnce,
  startImport,
  OBSIDIAN_VAULT,
  zipOf,
} from "../test-support/library-files";
import { cellOf, clockAt, engineIn, inCell, newAccountId } from "../test-support/library-cell";
import { readBlobRow } from "./cell-blobs";
import { LIBRARY_FULL } from "./cell-import-host";
import { runImports } from "./cell-imports";
import { cellStorageOf } from "./cell-storage";
import { z } from "zod";

const encoder = new TextEncoder();

const csv = (text: string) => ({ bytes: encoder.encode(text), mime: "text/csv" });

const zip = async (files: Readonly<Record<string, Uint8Array>>) => ({
  bytes: await zipOf(files),
  mime: "application/zip",
});

// what the library's files hold: every row, by its sha, and the bytes its quota counts
const filesIn = (state: DurableObjectState) => ({
  bytes: state.storage.sql.exec("SELECT v FROM meta WHERE k = 'bytes_used'").toArray()[0]?.v,
  shas: state.storage.sql
    .exec("SELECT sha256, refs FROM blobs ORDER BY sha256")
    .toArray()
    .map((row) => [row.sha256, row.refs]),
});

// a note of about `bytes` of plain paragraphs under its title
const noteOf = (title: string, bytes: number): Uint8Array =>
  encoder.encode(`# ${title}\n\n${"A line of plain words in a long note.\n\n".repeat(bytes / 40)}`);

const DAY_MS = 24 * 60 * 60 * 1000;
// past a Durable Object's 2 MB row, under what an item's text holds
const PAST_A_ROW = 3 * 1024 * 1024;

const blocksIn = async (accountId: string) =>
  await inCell(cellOf(accountId), (state) =>
    JSON.stringify(state.storage.sql.exec("SELECT json FROM blocks").toArray()),
  );

const importedZip = async (files: Readonly<Record<string, Uint8Array>>) => {
  const accountId = newAccountId();
  const started = await startImport(accountId, await zip(files), "markdown");
  await runToEnd(accountId, started.jobId);
  return { job: await jobOf(accountId, started.jobId), stored: await blocksIn(accountId) };
};

const items = (state: DurableObjectState) =>
  state.storage.sql
    .exec("SELECT id, title, url, folder_id, tags, fetch_state, kind FROM items ORDER BY title")
    .toArray();

describe("a Raindrop import", () => {
  it("lands every bookmark as an unread link in one change set, the file let go after", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, csv(RAINDROP_EXPORT), "raindrop", true);
    await runAlarmsUntil(cellOf(accountId), ended(accountId, started.jobId));
    const job = await jobOf(accountId, started.jobId);
    expect(job).toMatchObject({
      added: 6,
      // a row of an address an earlier row holds
      alreadySaved: 1,
      message: null,
      skipped: 3,
      state: "done",
      total: 10,
      unreadable: 0,
    });
    await inCell(cellOf(accountId), async (state) => {
      const landed = items(state);
      expect(landed).toHaveLength(6);
      expect(landed.every((row) => row.fetch_state === "pending")).toBe(true);
      const file = landed.find((row) => row.title === "File over app");
      expect(file?.url).toBe("https://stephango.com/file-over-app");
      const library = libraryIn(state, accountId);
      // its highlights, the later row's among them, fold into its note, each quoted with its own
      // note under it, a line break inside a quote kept as the editor spells one
      const { view } = await library.items.read({ id: z.string().parse(file?.id) });
      expect(view.markdown).toContain(
        "For Tuesday.\n\n> Files last.\n\nThe point.\n\n> Apps are ephemeral,\\\n> but files are not.\n\n> A third one.",
      );
      const outline = await library.organize.outline();
      expect(outline.folders.map((folder) => folder.name).toSorted()).toStrictEqual(
        expect.arrayContaining(["Cooking", "Reading", "Weeknight"]),
      );
      const sets = state.storage.sql
        .exec("SELECT id, label, sealed_at FROM change_sets WHERE actor = 'import'")
        .toArray();
      expect(sets).toStrictEqual([
        { id: job.changeSetId, label: "Imported from Raindrop", sealed_at: expect.any(Number) },
      ]);
      expect(readBlobRow(cellStorageOf(state.storage), started.sha)).toBeNull();
      // every reading the links wait for was sent to the fill queue
      expect(
        state.storage.sql.exec("SELECT id FROM jobs WHERE kind = 'fill'").toArray(),
      ).toStrictEqual([]);
      expect(state.storage.sql.exec("SELECT count(*) AS n FROM import_rows").one().n).toBe(0);
    });
    // the same file again: every address is the library's already
    const again = await startImport(accountId, csv(RAINDROP_EXPORT), "raindrop");
    await runToEnd(accountId, again.jobId);
    await expect(jobOf(accountId, again.jobId)).resolves.toMatchObject({
      added: 0,
      alreadySaved: 7,
    });
  });

  it("resumes where it stood after the cell was evicted mid-import, landing none twice", async () => {
    const accountId = newAccountId();
    const rows = Array.from(
      { length: 230 },
      (_, index) =>
        `${String(index)},Bookmark ${String(index)},,,https://example.com/n/${String(index)},Reading,,,,,`,
    );
    const text = [
      "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite",
      ...rows,
    ].join("\n");
    const started = await startImport(accountId, csv(text), "raindrop");
    const stub = cellOf(accountId);
    // the plan, then a page of bookmarks
    await runOnce(accountId);
    await runOnce(accountId);
    const part = await jobOf(accountId, started.jobId);
    expect(part).toMatchObject({ added: 100, state: "running" });
    await evictDurableObject(stub);
    // the rest: two more pages, the last ending the job
    await expect(runToEnd(accountId, started.jobId)).resolves.toBe(2);
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 230,
      state: "done",
      total: 230,
    });
    const count = await inCell(stub, (state) =>
      state.storage.sql
        .exec("SELECT count(*) AS n, count(DISTINCT url_key) AS keys FROM items")
        .one(),
    );
    expect(count).toStrictEqual({ keys: 230, n: 230 });
  });

  it("leaves out a row past what a plan row holds, and lands the rest", async () => {
    const accountId = newAccountId();
    const started = await startImport(
      accountId,
      csv(
        [
          "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite",
          `1,Long,${"n".repeat(PAST_A_ROW)},,https://example.com/long,,,,,,`,
          "2,Short,,,https://example.com/short,,,,,,",
        ].join("\n"),
      ),
      "raindrop",
      true,
    );
    await runAlarmsUntil(cellOf(accountId), ended(accountId, started.jobId));
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 1,
      state: "done",
      unreadable: 1,
    });
  });

  it("keeps a collection's name as Raindrop spelled it, cut to what a folder holds", async () => {
    const accountId = newAccountId();
    const started = await startImport(
      accountId,
      csv(`title,url,folder\nA,https://example.com/a,R&D: Notes/${"n".repeat(300)}\n`),
      "raindrop",
      true,
    );
    await runAlarmsUntil(cellOf(accountId), ended(accountId, started.jobId));
    await inCell(cellOf(accountId), async (state) => {
      const { folders } = await libraryIn(state, accountId).organize.outline();
      expect(folders.map((folder) => folder.name).toSorted()).toStrictEqual([
        "R&D: Notes",
        "n".repeat(FOLDER_NAME_MAX),
      ]);
    });
  });

  it("stops on a file that is no Raindrop export, saying how", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, csv("just,some\nwords,here\n"), "raindrop");
    await runToEnd(accountId, started.jobId);
    const job = await jobOf(accountId, started.jobId);
    expect(job.state).toBe("failed");
    expect(job.message).toContain("Raindrop export");
  });

  it("refuses a file the library does not hold", async () => {
    const accountId = newAccountId();
    await inCell(cellOf(accountId), async (state) => {
      await expect(
        libraryIn(state, accountId).imports.start({ sha: "a".repeat(64), source: "raindrop" }),
      ).rejects.toMatchObject({ code: "BLOB_MISSING" });
    });
  });
});

describe("a zip of notes", () => {
  it("reads Obsidian's vault: its notes, their links and files, its folders", async () => {
    const accountId = newAccountId();
    const started = await startImport(
      accountId,
      { bytes: await zipOf(OBSIDIAN_VAULT), mime: "application/zip" },
      "markdown",
    );
    await runToEnd(accountId, started.jobId);
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 3,
      skipped: 1,
      state: "done",
      total: 3,
      unreadable: 0,
    });
    await inCell(cellOf(accountId), async (state) => {
      const landed = items(state);
      expect(landed.map((row) => [row.title, row.kind])).toStrictEqual([
        ["Alpha", "note"],
        ["Beta", "note"],
        ["lone", "pdf"],
      ]);
      const beta = landed.find((row) => row.title === "Beta");
      const alpha = await libraryIn(state, accountId).items.read({
        id: z.string().parse(landed.find((row) => row.title === "Alpha")?.id),
      });
      expect(JSON.stringify(alpha)).toContain(z.string().parse(beta?.id));
      expect(alpha.fields.tags).toStrictEqual(["project"]);
    });
  });

  it("passes over what an operating system left in the zip, inside a bytes folder too", async () => {
    const accountId = newAccountId();
    const bytesFolder = "assets/0123456789abcdef";
    const started = await startImport(
      accountId,
      await zip({
        "Alpha.md": encoder.encode("A note.\n"),
        "Notes/Thumbs.db": encoder.encode("left by Windows"),
        "Notes/desktop.ini": encoder.encode("left by Windows too"),
        "__MACOSX/Notes/spec.pdf": encoder.encode("left by the Mac's zip"),
        [`${bytesFolder}/.DS_Store`]: encoder.encode("left by Finder"),
        [`${bytesFolder}/._board.md`]: encoder.encode("left by a Mac's disk"),
        [`${bytesFolder}/board.md`]: encoder.encode("kept under a note's name"),
      }),
      "markdown",
    );
    await runToEnd(accountId, started.jobId);
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 2,
      skipped: 5,
      state: "done",
      unreadable: 0,
    });
    await inCell(cellOf(accountId), async (state) => {
      const landed = items(state);
      expect(landed.map((row) => row.title)).toStrictEqual(["Alpha", "board"]);
      const { folders } = await libraryIn(state, accountId).organize.outline();
      expect(folders.map((folder) => folder.name)).toStrictEqual(["assets"]);
      const board = landed.find((row) => row.title === "board");
      expect(board?.folder_id).toBe(folders[0]?.id);
    });
  });

  it("lands a folder's AGENTS.md as a note, so no zip's text ever reaches the agent as the person's rules", async () => {
    const accountId = newAccountId();
    const started = await startImport(
      accountId,
      {
        bytes: await zipOf({ "AGENTS.md": encoder.encode("File recipes under Cooking.\n") }),
        mime: "application/zip",
      },
      "markdown",
    );
    await runToEnd(accountId, started.jobId);
    await inCell(cellOf(accountId), async (state) => {
      const library = libraryIn(state, accountId);
      await expect(library.agent.rules()).resolves.toStrictEqual({ rules: null });
      const note = items(state).find((row) => row.title === "AGENTS");
      const read = await library.items.read({ id: z.string().parse(note?.id) });
      expect(JSON.stringify(read)).toContain("File recipes under Cooking.");
    });
  });

  it("stops on a file that is no zip, saying how", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, csv("not a zip"), "markdown");
    await runToEnd(accountId, started.jobId);
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      message: expect.stringContaining("isn't a zip of notes"),
      state: "failed",
    });
  });
});

// the import read a path a run, the cell evicted after each, as a large zip reads
const inSteps = async (accountId: string, jobId: string): Promise<void> => {
  let at = Date.now();
  const past = () => {
    at += 11_000;
    return at;
  };
  for (let run = 0; run < 60; run += 1) {
    await inCell(cellOf(accountId), async (state) => {
      await runImports(jobHostIn(state, accountId, undefined, past));
    });
    await evictDurableObject(cellOf(accountId));
    if (await ended(accountId, jobId)()) {
      return;
    }
  }
  throw new Error("the import never ended");
};

// a zip read a path a run into a library of its own, and what it landed
const landedFrom = async (files: Readonly<Record<string, Uint8Array>>) => {
  const accountId = newAccountId();
  const started = await startImport(accountId, await zip(files), "markdown");
  await inSteps(accountId, started.jobId);
  const job = await jobOf(accountId, started.jobId);
  const read = await inCell(cellOf(accountId), async (state) => {
    const { folders } = await libraryIn(state, accountId).organize.outline();
    const names = new Map<unknown, string>(folders.map(({ id, name }) => [id, name]));
    return {
      folders: folders.map((folder) => folder.name).toSorted(),
      items: state.storage.sql
        .exec("SELECT title, kind, folder_id, cover_sha, original_sha FROM items ORDER BY title")
        .toArray()
        .map((row) => ({
          cover: row.cover_sha !== null,
          folder: names.get(row.folder_id) ?? null,
          kind: row.kind,
          original: row.original_sha !== null,
          title: row.title,
        })),
    };
  });
  return { job, read };
};

describe("a zip of an unpacked export", () => {
  const ID = "0195f3a0-5c1e-7000-8000-0000000000e1";
  const COVER = "assets/covers/0123456789abcdef.png";
  const PDF = "assets/spec.pdf";
  const KEPT = "assets/fedcba9876543210/readme.md";
  const TOP = "Library 2026-11-07";
  // what an export writes of a read link and of two files filed in a folder, whose held files it
  // names from the root
  const EXPORT = {
    [COVER]: pngOf(40, 30),
    [KEPT]: encoder.encode("kept under a note's name"),
    [PDF]: encoder.encode("%PDF-1.7\n% a file\n"),
    "Filed/Readme.md": encoder.encode(`---\nkind: file\n---\n\n![](${KEPT})\n`),
    "Filed/Spec.md": encoder.encode(`---\nkind: pdf\n---\n\n![](${PDF})\n`),
    "Reading/Marked.md": encoder.encode(
      [
        "---",
        `id: ${ID}`,
        "kind: link",
        "url: https://example.com/marked",
        "fetched: 2026-05-01T10:00:05Z",
        "---",
        "",
        `![](${COVER})`,
        "",
        ":::article",
        "",
        "Some marked words.",
        "",
        ":::",
        "",
      ].join("\n"),
    ),
  };

  // the same files under the folder they were unpacked to, with what a Mac's Compress adds
  const compressed = (files: Readonly<Record<string, Uint8Array>>) => ({
    ...Object.fromEntries(Object.entries(files).map(([path, bytes]) => [`${TOP}/${path}`, bytes])),
    ".DS_Store": encoder.encode("left by Finder"),
    [`${TOP}/.DS_Store`]: encoder.encode("left by Finder"),
    [`__MACOSX/${TOP}/._Spec.md`]: encoder.encode("left by the Mac's zip"),
  });

  it("reads as it reads at the zip's root, a run a path, once a Mac's Compress wrapped it", async () => {
    const rooted = await landedFrom(EXPORT);
    expect(rooted.read.items).toStrictEqual([
      { cover: true, folder: "Reading", kind: "link", original: false, title: "Marked" },
      { cover: false, folder: "Filed", kind: "file", original: true, title: "Readme" },
      { cover: false, folder: "Filed", kind: "pdf", original: true, title: "Spec" },
    ]);

    const wrapped = await landedFrom(compressed(EXPORT));

    expect(wrapped.read).toStrictEqual(rooted.read);
    expect(wrapped.job).toMatchObject({
      added: rooted.job.added,
      skipped: 3,
      state: "done",
      unreadable: 0,
    });
  }, 60_000);

  it("keeps a folder that holds nothing of an export's, as Obsidian's does", async () => {
    const { read } = await landedFrom({
      "MyVault/.obsidian/app.json": encoder.encode("{}"),
      "MyVault/Beta.md": encoder.encode("Beta's own words.\n"),
    });
    expect(read.items).toMatchObject([{ folder: "MyVault", title: "Beta" }]);
  });
});

describe("what a zip's note left out", () => {
  it("counts a block past what an item holds, and lands the note around it", async () => {
    const fence = `\`\`\`inteligir-html\n${"x".repeat(600 * 1024)}\n\`\`\`\n`;
    const { job, stored } = await importedZip({
      "Big.md": encoder.encode(`The words around it.\n\n${fence}`),
    });
    expect(job).toMatchObject({ added: 1, unreadable: 1 });
    expect(stored).toContain("The words around it.");
  });

  it("counts an entry whose deflated bytes are damaged, and reads the rest", async () => {
    const accountId = newAccountId();
    const file = await zip({
      "Bad.md": encoder.encode("A damaged note.\n"),
      "Good.md": encoder.encode("A whole note.\n"),
      "bad.txt": encoder.encode("A damaged file.\n"),
    });
    for (const name of ["Bad.md", "bad.txt"]) {
      // a deflate block's first byte, after the local header and its name, set to a block type
      // deflate does not have
      file.bytes[Buffer.from(file.bytes).indexOf(name) + name.length] = 0xff;
    }
    const started = await startImport(accountId, file, "markdown");
    await runToEnd(accountId, started.jobId);
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 1,
      state: "done",
      unreadable: 2,
    });
    await expect(blocksIn(accountId)).resolves.toContain("A whole note.");
  });

  it("counts frontmatter past what a plan row holds, and reads the rest", async () => {
    const { job, stored } = await importedZip({
      "Long.md": encoder.encode(`---\nauthor: ${"x".repeat(PAST_A_ROW)}\n---\nWords.\n`),
      "Whole.md": encoder.encode("A whole note.\n"),
    });
    expect(job).toMatchObject({ added: 1, state: "done", unreadable: 1 });
    expect(stored).toContain("A whole note.");
  });

  it("counts an AGENTS.md past what a note holds, as any note, and reads the rest", async () => {
    const { job, stored } = await importedZip({
      "AGENTS.md": encoder.encode("x".repeat(PAST_A_ROW)),
      "Whole.md": encoder.encode("A whole note.\n"),
    });
    expect(job).toMatchObject({ added: 1, state: "done", unreadable: 1 });
    expect(stored).toContain("A whole note.");
  });

  it("counts nothing for a link with no address, whose words stay", async () => {
    const { job, stored } = await importedZip({
      "Bare.md": encoder.encode("One [word]() and the rest.\n"),
    });
    expect(job).toMatchObject({ added: 1, unreadable: 0 });
    expect(stored).toContain("the rest.");
  });
});

describe("the files an import kept", () => {
  // two files of a few hundred KiB, which the first pass puts in the library as it reads them
  const FILES = {
    "a.bin": new Uint8Array(300 * 1024).fill(1),
    "b.bin": new Uint8Array(300 * 1024).fill(2),
    "note.md": encoder.encode("# A note\n\nWith a line.\n"),
  };

  it("go when it is cancelled mid-read, and so does the file it read", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, await zip(FILES), "markdown");
    await inCell(cellOf(accountId), async (state) => {
      // a clock past a run's page with each look, so the first run ends after its first path
      let at = Date.now();
      const host = jobHostIn(state, accountId, undefined, () => {
        at += 11_000;
        return at;
      });
      await runImports(host);
      expect(filesIn(state).shas).toHaveLength(2);
      await libraryIn(state, accountId).imports.cancel({ id: started.jobId });
      await runImports(host);
      expect(filesIn(state)).toStrictEqual({ bytes: 0, shas: [] });
    });
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 0,
      state: "cancelled",
    });
  });

  it("go when the library fills, and the import says why it stopped", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, await zip(FILES), "markdown");
    await inCell(cellOf(accountId), async (state) => {
      const bytes = Number(filesIn(state).bytes);
      // room for the first file and not the second
      const cap = bytes + state.storage.sql.databaseSize + 450 * 1024;
      await runImports(jobHostIn(state, accountId, engineIn(state, clockAt(Date.now()), cap)));
      expect(filesIn(state)).toStrictEqual({ bytes: 0, shas: [] });
    });
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      message: LIBRARY_FULL,
      state: "failed",
    });
  });

  it("are named by its items once it resumes after an eviction, and only the file it read goes", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, await zip(OBSIDIAN_VAULT), "markdown");
    await runOnce(accountId);
    await evictDurableObject(cellOf(accountId));
    await runToEnd(accountId, started.jobId);
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 3,
      state: "done",
    });
    await inCell(cellOf(accountId), (state) => {
      const held = filesIn(state);
      // the picture Alpha embeds and the PDF no note embeds, each named by its item
      expect(held.shas).toHaveLength(2);
      expect(held.shas.every(([, refs]) => refs === 1)).toBe(true);
      expect(held.bytes).toBe(
        OBSIDIAN_VAULT["pic.png"].length + OBSIDIAN_VAULT["Attachments/lone.pdf"].length,
      );
    });
  });
});

describe("an import's runs", () => {
  it("are counted before they start, so runs the platform ends stop the import", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, csv(RAINDROP_EXPORT), "raindrop");
    // each run is ended by the platform as soon as its count is on disk, a day apart
    for (let day = 1; day <= 5; day += 1) {
      await inCell(cellOf(accountId), async (state) => {
        const host = jobHostIn(state, accountId, undefined, () => Date.now() + day * DAY_MS);
        const cutOff = {
          ...host,
          durable: async () => {
            await host.durable();
            throw new Error("the platform ended the run");
          },
        };
        await expect(runImports(cutOff)).rejects.toThrow("the platform ended the run");
      });
    }
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 0,
      state: "running",
    });
    await inCell(cellOf(accountId), async (state) => {
      await runImports(jobHostIn(state, accountId, undefined, () => Date.now() + 6 * DAY_MS));
      expect(readBlobRow(cellStorageOf(state.storage), started.sha)).toBeNull();
    });
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 0,
      message: expect.stringContaining("something went wrong"),
      state: "failed",
    });
  });

  it("land notes until they have read their bytes' worth, and leave out one too long to read", async () => {
    const accountId = newAccountId();
    const started = await startImport(
      accountId,
      await zip({
        "a.md": noteOf("A", 200 * 1024),
        "b.md": noteOf("B", 200 * 1024),
        "c.md": noteOf("C", 200 * 1024),
        "huge.md": noteOf("Huge", 1100 * 1024),
      }),
      "markdown",
    );
    // the paths and the plan, then the first notes until their bytes pass a run's page
    await runOnce(accountId);
    await runOnce(accountId);
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 2,
      state: "running",
    });
    await runToEnd(accountId, started.jobId);
    await expect(jobOf(accountId, started.jobId)).resolves.toMatchObject({
      added: 3,
      state: "done",
      total: 4,
      unreadable: 1,
    });
  }, 120_000);
});
