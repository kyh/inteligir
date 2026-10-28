// Imports as the cell runs them: a file the device uploaded, read by the alarm a page at a time
// into one change set, an address the library holds counted rather than saved twice; a run cut off
// by an eviction resumes where it stood; a zip of notes, Obsidian's way included, read with its
// links, its files and its folders.

import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { RAINDROP_EXPORT } from "@repo/notes/imports/test-support/raindrop-export";
import { libraryIn } from "../fill/test-support/fill-cell";
import {
  ended,
  importJobOf as jobOf,
  jobHostIn,
  runAlarmsUntil,
  runImportToEnd as runToEnd,
  runImportsOnce as runOnce,
  startImport,
  VAULT,
  zipOf,
} from "../test-support/library-files";
import { cellOf, clockAt, engineIn, inCell, newAccountId } from "../test-support/library-cell";
import { readBlobRow } from "./cell-blobs";
import { LIBRARY_FULL } from "./cell-import-host";
import { readLibraryRules } from "./cell-import-markdown";
import { runImports } from "./cell-imports";
import { cellStorageOf } from "./cell-storage";

const encoder = new TextEncoder();

const csv = (text: string) => ({ bytes: encoder.encode(text), mime: "text/csv" });

const zip = async (files: Readonly<Record<string, Uint8Array>>) => ({
  bytes: await zipOf(files),
  mime: "application/zip",
});

// what the library's files hold: every row, by its sha, and the bytes its quota counts
const filesIn = (state: DurableObjectState) => ({
  bytes: state.storage.sql.exec("SELECT v FROM meta WHERE k = 'bytes_used'").toArray()[0]?.["v"],
  shas: state.storage.sql
    .exec("SELECT sha256, refs FROM blobs ORDER BY sha256")
    .toArray()
    .map((row) => [row["sha256"], row["refs"]]),
});

// a note of about `bytes` of plain paragraphs under its title
const noteOf = (title: string, bytes: number): Uint8Array =>
  encoder.encode(`# ${title}\n\n${"A line of plain words in a long note.\n\n".repeat(bytes / 40)}`);

const DAY_MS = 24 * 60 * 60 * 1000;

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
      highlights: 4,
      message: null,
      skipped: 3,
      state: "done",
      total: 10,
      unreadable: 0,
    });
    await inCell(cellOf(accountId), async (state) => {
      const landed = items(state);
      expect(landed).toHaveLength(6);
      expect(landed.every((row) => row["fetch_state"] === "pending")).toBe(true);
      const file = landed.find((row) => row["title"] === "File over app");
      expect(file?.["url"]).toBe("https://stephango.com/file-over-app");
      const library = libraryIn(state, accountId);
      const outline = await library.organize.outline();
      expect(outline.folders.map((folder) => folder.name).toSorted()).toEqual(
        expect.arrayContaining(["Cooking", "Reading", "Weeknight"]),
      );
      const sets = state.storage.sql
        .exec("SELECT id, label, sealed_at FROM change_sets WHERE actor = 'import'")
        .toArray();
      expect(sets).toEqual([
        { id: job.changeSetId, label: "Imported from Raindrop", sealed_at: expect.any(Number) },
      ]);
      expect(readBlobRow(cellStorageOf(state.storage), started.sha)).toBeNull();
      // every reading the links wait for was sent to the fill queue
      expect(state.storage.sql.exec("SELECT id FROM jobs WHERE kind = 'fill'").toArray()).toEqual(
        [],
      );
      expect(state.storage.sql.exec("SELECT count(*) AS n FROM import_rows").one()["n"]).toBe(0);
    });
    // the same file again: every address is the library's already
    const again = await startImport(accountId, csv(RAINDROP_EXPORT), "raindrop");
    await runToEnd(accountId, again.jobId);
    expect(await jobOf(accountId, again.jobId)).toMatchObject({ added: 0, alreadySaved: 7 });
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
    expect(await runToEnd(accountId, started.jobId)).toBe(2);
    expect(await jobOf(accountId, started.jobId)).toMatchObject({
      added: 230,
      state: "done",
      total: 230,
    });
    const count = await inCell(stub, (state) =>
      state.storage.sql
        .exec("SELECT count(*) AS n, count(DISTINCT url_key) AS keys FROM items")
        .one(),
    );
    expect(count).toEqual({ keys: 230, n: 230 });
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
  it("reads Obsidian's vault: its notes, their links and files, its folders, its filing rules", async () => {
    const accountId = newAccountId();
    const started = await startImport(
      accountId,
      { bytes: await zipOf(VAULT), mime: "application/zip" },
      "markdown",
    );
    await runToEnd(accountId, started.jobId);
    expect(await jobOf(accountId, started.jobId)).toMatchObject({
      added: 3,
      skipped: 1,
      state: "done",
      total: 3,
      unreadable: 0,
    });
    await inCell(cellOf(accountId), async (state) => {
      const landed = items(state);
      expect(landed.map((row) => [row["title"], row["kind"]])).toEqual([
        ["Alpha", "note"],
        ["Beta", "note"],
        ["lone", "pdf"],
      ]);
      const beta = landed.find((row) => row["title"] === "Beta");
      const alpha = await libraryIn(state, accountId).items.read({
        id: String(landed.find((row) => row["title"] === "Alpha")?.["id"]),
      });
      expect(JSON.stringify(alpha)).toContain(String(beta?.["id"]));
      expect(alpha.fields.tags).toEqual(["project"]);
      expect(readLibraryRules(cellStorageOf(state.storage))).toBe("File recipes under Cooking.\n");
    });
  });

  it("stops on a file that is no zip, saying how", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, csv("not a zip"), "markdown");
    await runToEnd(accountId, started.jobId);
    expect(await jobOf(accountId, started.jobId)).toMatchObject({
      message: expect.stringContaining("isn't a zip of notes"),
      state: "failed",
    });
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
      expect(filesIn(state)).toEqual({ bytes: 0, shas: [] });
    });
    expect(await jobOf(accountId, started.jobId)).toMatchObject({ added: 0, state: "cancelled" });
  });

  it("go when the library fills, and the import says why it stopped", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, await zip(FILES), "markdown");
    await inCell(cellOf(accountId), async (state) => {
      const bytes = Number(filesIn(state).bytes);
      // room for the first file and not the second
      const cap = bytes + state.storage.sql.databaseSize + 450 * 1024;
      await runImports(jobHostIn(state, accountId, engineIn(state, clockAt(Date.now()), cap)));
      expect(filesIn(state)).toEqual({ bytes: 0, shas: [] });
    });
    expect(await jobOf(accountId, started.jobId)).toMatchObject({
      message: LIBRARY_FULL,
      state: "failed",
    });
  });

  it("are named by its items once it resumes after an eviction, and only the file it read goes", async () => {
    const accountId = newAccountId();
    const started = await startImport(accountId, await zip(VAULT), "markdown");
    await runOnce(accountId);
    await evictDurableObject(cellOf(accountId));
    await runToEnd(accountId, started.jobId);
    expect(await jobOf(accountId, started.jobId)).toMatchObject({ added: 3, state: "done" });
    await inCell(cellOf(accountId), (state) => {
      const held = filesIn(state);
      // the picture Alpha embeds and the PDF no note embeds, each named by its item
      expect(held.shas).toHaveLength(2);
      expect(held.shas.every(([, refs]) => refs === 1)).toBe(true);
      expect(held.bytes).toBe(VAULT["pic.png"].length + VAULT["Attachments/lone.pdf"].length);
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
    expect(await jobOf(accountId, started.jobId)).toMatchObject({ added: 0, state: "running" });
    await inCell(cellOf(accountId), async (state) => {
      await runImports(jobHostIn(state, accountId, undefined, () => Date.now() + 6 * DAY_MS));
      expect(readBlobRow(cellStorageOf(state.storage), started.sha)).toBeNull();
    });
    expect(await jobOf(accountId, started.jobId)).toMatchObject({
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
    expect(await jobOf(accountId, started.jobId)).toMatchObject({ added: 2, state: "running" });
    await runToEnd(accountId, started.jobId);
    expect(await jobOf(accountId, started.jobId)).toMatchObject({
      added: 3,
      state: "done",
      total: 4,
      unreadable: 1,
    });
  }, 120_000);
});
