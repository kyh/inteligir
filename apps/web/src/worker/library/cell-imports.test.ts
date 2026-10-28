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
  runAlarmsUntil,
  runImportToEnd as runToEnd,
  runImportsOnce as runOnce,
  startImport,
  VAULT,
  zipOf,
} from "../test-support/library-files";
import { cellOf, inCell, newAccountId } from "../test-support/library-cell";
import { readBlobRow } from "./cell-blobs";
import { readLibraryRules } from "./cell-import-markdown";
import { cellStorageOf } from "./cell-storage";

const encoder = new TextEncoder();

const csv = (text: string) => ({ bytes: encoder.encode(text), mime: "text/csv" });

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
