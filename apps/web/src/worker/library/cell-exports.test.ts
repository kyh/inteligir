// Exports as the cell writes them: the whole library a zip in the vault's format under the
// account's prefix in R2, read back into another library as the same items, links and files;
// downloaded behind the credential, a range at a time; and let go after its seven days.

import { V1_EXPORTS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { libraryIn } from "../fill/test-support/fill-cell";
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
  VAULT,
  zipOf,
} from "../test-support/library-files";
import { cellOf, inCell, newAccountId } from "../test-support/library-cell";
import { readZipEntries } from "../zip/zip-read";
import { EXPORT_KEEP_MS, exportKey, runExports } from "./cell-exports";
import { openCellLibrary } from "./cell-library";

// an account holding the small vault, imported
const withVault = async (accountId: string): Promise<void> => {
  const started = await startImport(
    accountId,
    { bytes: await zipOf(VAULT), mime: "application/zip" },
    "markdown",
  );
  await runImportToEnd(accountId, started.jobId);
};

// the export started and written, as the alarm writes it at `now`
const exported = async (accountId: string, now = Date.now) =>
  await inCell(cellOf(accountId), async (state) => {
    const library = openCellLibrary(state, env);
    const client = libraryIn(state, accountId, library);
    const started = await client.exports.start({});
    // a second ask while it is written answers with the same export
    const again = await client.exports.start({});
    expect(again.export.id).toBe(started.export.id);
    await runExports(jobHostIn(state, accountId, library, now));
    const { export: written } = await client.exports.get({ id: started.export.id });
    return written;
  });

const zipIn = async (accountId: string, id: string): Promise<Uint8Array> => {
  const object = await env.BLOBS.get(exportKey(accountId, id));
  return new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0));
};

const summaryOf = async (accountId: string) =>
  await inCell(cellOf(accountId), async (state) => {
    const client = libraryIn(state, accountId);
    const listed = await client.items.list({});
    const outline = await client.organize.outline();
    const read = await Promise.all(
      listed.items.map(async (item) => await client.items.read({ id: item.id })),
    );
    const titleById = new Map(read.map((item) => [item.id, item.fields.title]));
    const { highlights } = await client.annotations.list({});
    return {
      folders: outline.folders.map((folder) => folder.name).toSorted(),
      highlights: highlights.map((highlight) => [
        highlight.itemTitle,
        highlight.quote,
        highlight.text,
      ]),
      items: read
        .map((item) => ({
          kind: item.fields.kind,
          // every item another links names by its title, whatever its id in this library
          links: [...titleById].flatMap(([id, title]) =>
            id !== item.id && JSON.stringify(item).includes(id) ? [title] : [],
          ),
          tags: item.fields.tags,
          title: item.fields.title,
        }))
        .toSorted((a, b) => a.title.localeCompare(b.title)),
    };
  });

describe("an export", () => {
  it("writes the library as a zip in the vault's format, which reads back as the same library", async () => {
    const from = newAccountId();
    await withVault(from);
    await inCell(cellOf(from), async (state) => {
      const client = libraryIn(state, from);
      const listed = await client.items.list({});
      const alpha = listed.items.find((item) => item.title === "Alpha");
      await client.annotations.add({
        itemId: alpha?.id ?? "",
        note: "Why it matters.",
        quote: "See",
      });
    });
    const written = await exported(from);
    expect(written).toMatchObject({ message: null, state: "ready" });
    expect(written.expiresAt).toBe((written.finishedAt ?? 0) + EXPORT_KEEP_MS);
    const zip = await zipIn(from, written.id);
    expect(zip.length).toBe(written.bytes);
    const entries = await readZipEntries({
      read: async (offset, length) => await Promise.resolve(zip.slice(offset, offset + length)),
      size: zip.length,
    });
    const paths = entries.map((entry) => entry.path);
    expect(paths).toEqual(expect.arrayContaining(["AGENTS.md", "Beta.md", "Notes/Alpha.md"]));

    const into = newAccountId();
    const started = await startImport(into, { bytes: zip, mime: "application/zip" }, "markdown");
    await runImportToEnd(into, started.jobId);
    expect(await importJobOf(into, started.jobId)).toMatchObject({
      state: "done",
      unreadable: 0,
    });
    expect(await summaryOf(into)).toEqual(await summaryOf(from));
  });

  it("is downloaded behind the credential, a range at a time, and let go after seven days", async () => {
    const { cookie } = await signUpUser("export-download@example.test");
    const laptop = await loginDevice(cookie, "Laptop");
    const accountId = await userIdOf(cookie);
    await withVault(accountId);
    const written = await exported(accountId);
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
