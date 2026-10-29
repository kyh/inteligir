// Exports as the cell writes them: the whole library a zip in the vault's format under the
// account's prefix in R2, read back into another library as the same items, their text, their
// links, highlights and files; written over many runs of the alarm, an eviction among them, into
// the same entries one run writes; failed once its runs keep being cut off, so another can start;
// downloaded behind the credential, a range at a time; and let go after its seven days.

import { V1_EXPORTS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { evictDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { libraryIn, pngOf } from "../fill/test-support/fill-cell";
import {
  buildHeaders,
  deviceHeaders,
  drained,
  loginDevice,
  ORIGIN,
  signUpUser,
  userIdOf,
} from "../test-support/cloud-helpers";
import {
  importJobOf,
  jobHostIn,
  runImportToEnd,
  startImport,
  uploadedFile,
  VAULT,
  zipOf,
} from "../test-support/library-files";
import { cellOf, inCell, newAccountId, paragraph } from "../test-support/library-cell";
import { readZipEntries, readZipEntry } from "../zip/zip-read";
import type { ByteSource } from "../zip/zip-read";
import { EXPORT_KEEP_MS, EXPORT_LIMITS, exportKey, runExports } from "./cell-exports";
import type { ExportLimits } from "./cell-exports";
import { openCellLibrary } from "./cell-library";

const LINK = "https://pages.example/reading";

// an account holding the small vault, imported, beside a saved link the cloud read: its article,
// its cover, and a highlight placed in the article
const withLibrary = async (
  accountId: string,
  files: Readonly<Record<string, Uint8Array>> = {},
): Promise<void> => {
  const started = await startImport(
    accountId,
    { bytes: await zipOf({ ...VAULT, ...files }), mime: "application/zip" },
    "markdown",
  );
  await runImportToEnd(accountId, started.jobId);
  await inCell(cellOf(accountId), async (state) => {
    const library = openCellLibrary(state, env);
    const client = libraryIn(state, accountId, library);
    const listed = await client.items.list({});
    const alpha = listed.items.find((item) => item.title === "Alpha");
    await client.annotations.add({
      itemId: alpha?.id ?? "",
      note: "Why it matters.",
      quote: "See",
    });
    const saved = await client.items.saveLink({ note: "Read on the train.", url: LINK });
    const coverSha = await uploadedFile(library, accountId, {
      bytes: pngOf(1200, 630),
      mime: "image/png",
    });
    library.landReading({
      article: [
        { block: paragraph("a1", "The first paragraph of the page."), ord: "a0" },
        { block: paragraph("a2", "A passage worth keeping, in the middle."), ord: "a1" },
      ],
      coverSha,
      facts: { author: "A. Writer", description: null, lang: "en", published: null, site: "Pages" },
      finalUrl: LINK,
      itemId: saved.item.id,
      kind: "read",
      playable: null,
      title: "A page worth reading",
      url: LINK,
    });
    await client.annotations.add({ itemId: saved.item.id, note: "", quote: "worth keeping" });
  });
};

// tiny runs: an item planned, written or a file written each, the zip in R2's smallest parts
const TINY: ExportLimits = { partBytes: 5 * 1024 * 1024, planItems: 1, textBytes: 1, zipBytes: 1 };

// bytes no deflate shrinks, so the zip they go in passes a part's length
const noise = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  for (let at = 0; at < length; at += 65_536) {
    crypto.getRandomValues(bytes.subarray(at, at + 65_536));
  }
  return bytes;
};

const writingOf = (state: DurableObjectState, id: string): boolean =>
  state.storage.sql.exec("SELECT state FROM export_jobs WHERE id = ?", id).one()["state"] ===
  "writing";

// the export started and run by the alarm until it is written, a run each turn and `between` each
// turn's end; how many runs it took
const exported = async (
  accountId: string,
  limits: ExportLimits = EXPORT_LIMITS,
  between: (run: number) => Promise<void> = async () => {},
) => {
  const id = await inCell(cellOf(accountId), async (state) => {
    const client = libraryIn(state, accountId);
    const started = await client.exports.start({});
    // a second ask while it is written answers with the same export
    const again = await client.exports.start({});
    expect(again.export.id).toBe(started.export.id);
    return started.export.id;
  });
  for (let runs = 1; runs <= 200; runs += 1) {
    const writing = await inCell(cellOf(accountId), async (state) => {
      await runExports(jobHostIn(state, accountId), limits);
      return writingOf(state, id);
    });
    if (!writing) {
      const written = await inCell(cellOf(accountId), async (state) =>
        libraryIn(state, accountId).exports.get({ id }),
      );
      return { export: written.export, runs };
    }
    await between(runs);
  }
  throw new Error("the export was never written");
};

const zipIn = async (accountId: string, id: string): Promise<Uint8Array> => {
  const object = await env.BLOBS.get(exportKey(accountId, id));
  return new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0));
};

const sourceOf = (bytes: Uint8Array): ByteSource => ({
  read: async (offset, length) => await Promise.resolve(bytes.slice(offset, offset + length)),
  size: bytes.length,
});

const hex = (digest: ArrayBuffer): string =>
  [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// what the zip holds, each file's digest by its path
const entriesOf = async (zip: Uint8Array): Promise<Map<string, string>> => {
  const source = sourceOf(zip);
  const entries = await readZipEntries(source);
  const digests = new Map<string, string>();
  for (const entry of entries) {
    const bytes = await readZipEntry(source, entry, 64 * 1024 * 1024);
    digests.set(entry.path, hex(await crypto.subtle.digest("SHA-256", bytes)));
  }
  return digests;
};

// the library as another library holding the same items would read: each item's fields, its
// note's and its article's text, the items it links by their titles and the files it holds, which
// are named by their bytes and so the same in any library
const summaryOf = async (accountId: string) =>
  await inCell(cellOf(accountId), async (state) => {
    const client = libraryIn(state, accountId);
    const listed = await client.items.list({});
    const outline = await client.organize.outline();
    const read = await Promise.all(
      listed.items.map(async (item) => await client.items.read({ id: item.id })),
    );
    const titleById = new Map(read.map((item) => [item.id, item.fields.title]));
    const { sql } = state.storage;
    const textOf = (id: string, section: "note" | "article") =>
      sql
        .exec("SELECT text FROM blocks WHERE item_id = ? AND section = ? ORDER BY ord", id, section)
        .toArray()
        .map((row) => row["text"]);
    const { highlights } = await client.annotations.list({});
    return {
      folders: outline.folders.map((folder) => folder.name).toSorted(),
      highlights: highlights
        .map((highlight) => [highlight.itemTitle, highlight.quote, highlight.text])
        .toSorted(),
      items: read
        .map((item) => ({
          article: textOf(item.id, "article"),
          fields: {
            author: item.fields.author,
            kind: item.fields.kind,
            site: item.fields.site,
            tags: item.fields.tags,
            url: item.fields.url,
          },
          files: sql
            .exec(
              "SELECT role, sha256 FROM item_blobs WHERE item_id = ? ORDER BY role, sha256",
              item.id,
            )
            .toArray()
            .map((row) => [row["role"], row["sha256"]]),
          // every item another links names by its title, whatever its id in this library
          links: [...titleById].flatMap(([id, title]) =>
            id !== item.id && JSON.stringify(item).includes(id) ? [title] : [],
          ),
          note: textOf(item.id, "note"),
          title: item.fields.title,
        }))
        .toSorted((a, b) => a.title.localeCompare(b.title)),
    };
  });

describe("an export", () => {
  it("writes the library as a zip in the vault's format, which reads back as the same library", async () => {
    const from = newAccountId();
    await withLibrary(from);
    const { export: written } = await exported(from);
    expect(written).toMatchObject({ message: null, state: "ready" });
    expect(written.expiresAt).toBe((written.finishedAt ?? 0) + EXPORT_KEEP_MS);
    const zip = await zipIn(from, written.id);
    expect(zip.length).toBe(written.bytes);
    const entries = await entriesOf(zip);
    expect([...entries.keys()]).toEqual(
      expect.arrayContaining(["AGENTS.md", "Beta.md", "Notes/Alpha.md", "A page worth reading.md"]),
    );

    const into = newAccountId();
    const started = await startImport(into, { bytes: zip, mime: "application/zip" }, "markdown");
    await runImportToEnd(into, started.jobId);
    expect(await importJobOf(into, started.jobId)).toMatchObject({
      state: "done",
      unreadable: 0,
    });
    const before = await summaryOf(from);
    // the fixture holds what a faithful round trip must carry
    const link = before.items.find((item) => item.title === "A page worth reading");
    expect(link?.article).toHaveLength(2);
    expect(link?.files.map(([role]) => role)).toEqual(["cover"]);
    expect(before.highlights).toHaveLength(2);
    expect(await summaryOf(into)).toEqual(before);
  });

  it("is written over many runs, an eviction among them, into the entries one run writes", async () => {
    const accountId = newAccountId();
    // a file past two parts' length, so runs upload parts and hand the bytes past them on
    await withLibrary(accountId, { "Attachments/noise.bin": noise(11 * 1024 * 1024) });
    const whole = await exported(accountId);
    const wholeEntries = await entriesOf(await zipIn(accountId, whole.export.id));
    const cell = cellOf(accountId);
    const piecemeal = await exported(accountId, TINY, async (run) => {
      if (run === 7) {
        await evictDurableObject(cell);
      }
    });
    expect(piecemeal.export.state).toBe("ready");
    // a run each for the plan, the items, their files and the directory; then a run an item
    // planned, an item written and a file written
    expect(whole.runs).toBe(4);
    expect(piecemeal.runs).toBeGreaterThan(wholeEntries.size);
    const zip = await zipIn(accountId, piecemeal.export.id);
    expect(zip.length).toBe(piecemeal.export.bytes);
    expect(await entriesOf(zip)).toEqual(wholeEntries);
    // what the runs kept between them is let go with the export
    await inCell(cell, (state) => {
      expect(state.storage.sql.exec("SELECT count(*) AS n FROM export_rows").one()["n"]).toBe(0);
      expect(state.storage.sql.exec("SELECT count(*) AS n FROM export_tail").one()["n"]).toBe(0);
    });
  }, 120_000);

  it("fails once its runs keep being cut off, so another export can start", async () => {
    const accountId = newAccountId();
    await withLibrary(accountId);
    const id = await inCell(cellOf(accountId), async (state) => {
      const started = await libraryIn(state, accountId).exports.start({});
      return started.export.id;
    });
    // each run is ended by the platform as soon as its count is on disk, an hour apart
    for (let hour = 1; hour <= 3; hour += 1) {
      await inCell(cellOf(accountId), async (state) => {
        const host = jobHostIn(state, accountId, undefined, () => Date.now() + hour * 3_600_000);
        const cutOff = {
          ...host,
          durable: async () => {
            await host.durable();
            throw new Error("the platform ended the run");
          },
        };
        await expect(runExports(cutOff)).rejects.toThrow("the platform ended the run");
      });
    }
    const after = await inCell(cellOf(accountId), async (state) => {
      // the run after the last it may take fails it
      await runExports(jobHostIn(state, accountId, undefined, () => Date.now() + 4 * 3_600_000));
      const client = libraryIn(state, accountId);
      const { export: ended } = await client.exports.get({ id });
      const { export: next } = await client.exports.start({});
      return { ended, next };
    });
    expect(after.ended).toMatchObject({
      message: expect.stringContaining("couldn't"),
      state: "failed",
    });
    expect(after.next.id).not.toBe(id);
  });

  it("is downloaded behind the credential, a range at a time, and let go after seven days", async () => {
    const { cookie } = await signUpUser("export-download@example.test");
    const laptop = await loginDevice(cookie, "Laptop");
    const accountId = await userIdOf(cookie);
    await withLibrary(accountId);
    const { export: written } = await exported(accountId);
    const url = `${ORIGIN}${V1_EXPORTS_PATH}/${written.id}`;
    const auth = deviceHeaders(laptop.credential);

    const whole = await exports.default.fetch(url, { headers: auth });
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("application/zip");
    expect(whole.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Library \d{4}-\d{2}-\d{2}\.zip"$/u,
    );
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(await zipIn(accountId, written.id));

    const part = await exports.default.fetch(url, { headers: { ...auth, range: "bytes=0-3" } });
    expect(part.status).toBe(206);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));

    const signedOut = await drained(exports.default.fetch(url, { headers: buildHeaders() }));
    expect(signedOut.status).toBe(401);
    const other = await drained(
      exports.default.fetch(`${ORIGIN}${V1_EXPORTS_PATH}/${crypto.randomUUID()}`, {
        headers: auth,
      }),
    );
    expect(other.status).toBe(404);

    // seven days on, the alarm lets it go
    await inCell(cellOf(accountId), async (state) => {
      await runExports(
        jobHostIn(state, accountId, undefined, () => Date.now() + EXPORT_KEEP_MS + 1000),
      );
      const { export: gone } = await libraryIn(state, accountId).exports.get({ id: written.id });
      expect(gone.state).toBe("expired");
    });
    expect(await env.BLOBS.head(exportKey(accountId, written.id))).toBeNull();
    const after = await drained(exports.default.fetch(url, { headers: auth }));
    expect(after.status).toBe(404);
  });
});
