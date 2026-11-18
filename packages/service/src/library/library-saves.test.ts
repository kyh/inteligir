import { noteFixture, paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { db } from "@repo/db/drizzle-client";
import { item, job, libraryState } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { env } from "../env";
import { signUpUser, userIdOf } from "../test-support/auth-requests.test-utils";
import { personalLibrary, seedFile, seedItem } from "../test-support/library.fixture";
import { extensionHeaders, v1Link } from "../test-support/v1-link.test-utils";
import { mintLibraryId } from "./library-ids";

const SAVED_AT = 1_700_000_000_000;
const PDF_SHA = "b".repeat(64);
const FACTS = { author: null, description: null, lang: null, published: null, site: null };

const newId = () => mintLibraryId(Date.now());

const TOO_DEEP_NOTE = `${"> ".repeat(12_000)}too deep`;

const NESTS_TOO_DEEP = {
  code: "PAYLOAD_TOO_LARGE",
  message:
    "That new text nests deeper than an item holds. Nest its lists and quotes fewer levels deep.",
};

const refusalOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (isOrpcError(error)) {
      return { code: error.code, data: error.data, defined: error.defined };
    }

    throw error;
  }

  throw new Error("the call landed what the test expected it to refuse");
};

const pageSave = (url: string, words = "The quick brown fox jumps over the lazy dog.") => ({
  article: [paragraph(`p-${newId()}`, words)],
  coverSha: null,
  facts: { ...FACTS, site: "example.com" },
  folderId: null,
  id: newId(),
  savedAt: SAVED_AT,
  tags: [],
  title: "A page",
  url,
});

const fillJobs = async (accountId: string) =>
  await db
    .select({ attempts: job.attempts, id: job.id, kind: job.kind, payload: job.payload })
    .from(job)
    .where(eq(job.accountId, accountId))
    .orderBy(asc(job.id));

const headOf = async (accountId: string) => {
  const [row] = await db
    .select({ head: libraryState.head })
    .from(libraryState)
    .where(eq(libraryState.accountId, accountId));

  return row?.head ?? 0;
};

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const bodyOf = async (library: Library, id: string) => {
  const { blocks } = await library.items.get({ id });

  return blocks.map(({ block, section }) => ({ children: block.children, section }));
};

const mention = (itemId: string, value: string) => ({
  children: [{ text: "" }],
  key: itemId,
  type: "mention",
  value,
});

dbSuite("saving a web address", () => {
  describe("a link to read later", () => {
    it("lands unread and asks for its reading in the same write, and a second save of its address answers it as it stands", async () => {
      const { accountId, library } = await personalLibrary();
      const url = "https://example.com/later/a-long-read";
      const saved = await library.items.saveLink({ url });
      expect(saved).toMatchObject({
        created: true,
        item: { fields: { kind: "link", reading: { at: null, state: "pending" }, url } },
      });
      expect(saved.item.card.title).not.toBe("");
      await expect(fillJobs(accountId)).resolves.toStrictEqual([
        {
          attempts: 0,
          id: `fill:${saved.item.id}`,
          kind: "fill",
          payload: { coverHint: null, itemId: saved.item.id, url },
        },
      ]);

      const head = await headOf(accountId);

      const again = await library.items.saveLink({
        note: "Nothing of this lands.",
        title: "Another name",
        url: `${url}#a-fragment`,
      });

      expect(again).toStrictEqual({ created: false, item: saved.item });
      expect(await headOf(accountId)).toBe(head);
      await expect(fillJobs(accountId)).resolves.toHaveLength(1);
    });

    it("keeps the words it was saved with as its note, files it by a folder's path and answers a resend by its op id", async () => {
      const { accountId, library } = await personalLibrary();
      const opId = newId();

      const input = {
        folder: { path: "Work / Reading" },
        note: "For Tuesday, before the call.",
        opId,
        tags: ["later"],
        title: "A long read",
        url: "https://example.com/words",
      };

      const saved = await library.items.saveLink(input);
      expect(saved.item.fields).toMatchObject({ tags: ["later"], title: "A long read" });
      expect(saved.item.fields.folderId).not.toBeNull();
      await expect(bodyOf(library, saved.item.id)).resolves.toStrictEqual([
        { children: [{ text: "For Tuesday, before the call." }], section: "note" },
      ]);
      await expect(library.items.saveLink(input)).resolves.toStrictEqual(saved);

      const items = await db
        .select({ id: item.id })
        .from(item)
        .where(eq(item.accountId, accountId));

      expect(items).toHaveLength(1);
    });

    it("refuses an id another item holds as a conflict, a folder it lacks and words nested too deep", async () => {
      const { library } = await personalLibrary();
      const { item: held } = await library.items.saveLink({ url: "https://example.com/held" });
      await expect(
        refusalOf(library.items.saveLink({ id: held.id, url: "https://example.com/else" })),
      ).resolves.toStrictEqual({ code: "CONFLICT", data: undefined, defined: true });
      await expect(
        refusalOf(
          library.items.saveLink({ folder: { id: newId() }, url: "https://example.com/filed" }),
        ),
      ).resolves.toMatchObject({ code: "NOT_FOUND", defined: true });
      await expect(
        library.items.saveLink({ note: TOO_DEEP_NOTE, url: "https://example.com/deep" }),
      ).rejects.toMatchObject({ ...NESTS_TOO_DEEP, defined: true });
    });

    it("asks for its reading again when it comes back from Deleted still waiting, and not once read", async () => {
      const { accountId, library } = await personalLibrary();
      const saved = await library.items.saveLink({ url: "https://example.com/restored" });
      await db.delete(job).where(eq(job.accountId, accountId));
      await library.items.delete({ ids: [saved.item.id] });
      await expect(fillJobs(accountId)).resolves.toStrictEqual([]);
      await library.items.restore({ ids: [saved.item.id] });
      await expect(fillJobs(accountId)).resolves.toMatchObject([{ id: `fill:${saved.item.id}` }]);

      const read = await library.items.save(pageSave("https://example.com/read"));
      await library.items.delete({ ids: [read.item.id] });
      await library.items.restore({ ids: [read.item.id] });
      await expect(fillJobs(accountId)).resolves.toHaveLength(1);
    });
  });

  describe("a page a device read", () => {
    it("lands read, the words it was saved with its note and its article after", async () => {
      const { accountId, library } = await personalLibrary();
      const page = { ...pageSave("https://example.com/page"), note: "Worth a second look." };
      const saved = await library.items.save(page);
      expect(saved).toMatchObject({
        created: true,
        item: { fields: { reading: { state: "read" }, site: "example.com", title: "A page" } },
      });
      await expect(bodyOf(library, saved.item.id)).resolves.toStrictEqual([
        { children: [{ text: "Worth a second look." }], section: "note" },
        {
          children: [{ text: "The quick brown fox jumps over the lazy dog." }],
          section: "article",
        },
      ]);
      await expect(fillJobs(accountId)).resolves.toStrictEqual([]);
    });

    it("refuses words nested too deep as that, landing no item", async () => {
      const { accountId, library } = await personalLibrary();
      const head = await headOf(accountId);
      await expect(
        library.items.save({ ...pageSave("https://example.com/deep-page"), note: TOO_DEEP_NOTE }),
      ).rejects.toMatchObject({ ...NESTS_TOO_DEEP, defined: true });
      expect(await headOf(accountId)).toBe(head);
    });

    it("lands on a held link still waiting or whose reading failed, after its note, and on none already read", async () => {
      const { accountId, library } = await personalLibrary();
      const url = "https://example.com/waiting";
      const stub = await library.items.saveLink({ note: "For Tuesday.", url });
      const landed = await library.items.save(pageSave(url));
      expect(landed).toMatchObject({
        created: false,
        item: { fields: { reading: { state: "read" }, title: "A page" }, id: stub.item.id },
      });
      await expect(bodyOf(library, stub.item.id)).resolves.toStrictEqual([
        { children: [{ text: "For Tuesday." }], section: "note" },
        {
          children: [{ text: "The quick brown fox jumps over the lazy dog." }],
          section: "article",
        },
      ]);
      const reread = await library.items.save(pageSave(url, "Another article altogether."));
      expect(reread).toStrictEqual({ created: false, item: landed.item });

      const failed = await seedItem(accountId, {
        fields: noteFixture({
          kind: "link",
          reading: { at: null, error: "The site refused the read.", state: "failed" },
          title: "A refusing site",
          url: "https://example.com/refuses",
        }),
      });

      const retried = await library.items.save(pageSave("https://example.com/refuses"));
      expect(retried).toMatchObject({
        created: false,
        item: { fields: { reading: { state: "read" }, title: "A refusing site" }, id: failed.id },
      });
    });

    it("is read again on asking, waiting with its article and when it was read kept, once under its op id, and a note has no page to read", async () => {
      const { accountId, library } = await personalLibrary();
      const read = await library.items.save(pageSave("https://example.com/again"));
      const readAt = read.item.fields.reading.state === "read" ? read.item.fields.reading.at : -1;
      const opId = newId();
      const refreshed = await library.items.refresh({ id: read.item.id, opId });
      expect(refreshed).toMatchObject({
        item: { fields: { reading: { at: readAt, state: "pending" } }, id: read.item.id },
      });
      await expect(bodyOf(library, read.item.id)).resolves.toStrictEqual([
        {
          children: [{ text: "The quick brown fox jumps over the lazy dog." }],
          section: "article",
        },
      ]);
      await expect(fillJobs(accountId)).resolves.toMatchObject([
        { id: `fill:${read.item.id}`, kind: "fill", payload: { url: "https://example.com/again" } },
      ]);
      const head = await headOf(accountId);
      await expect(library.items.refresh({ id: read.item.id, opId })).resolves.toStrictEqual(
        refreshed,
      );
      expect(await headOf(accountId)).toBe(head);

      const note = await library.items.createNote({ markdown: "Mine.", title: "A note" });
      await expect(refusalOf(library.items.refresh({ id: note.item.id }))).resolves.toMatchObject({
        code: "NOT_FOUND",
        defined: true,
      });
      await expect(refusalOf(library.items.refresh({ id: newId() }))).resolves.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  it("links a [[Title]] in a save's words to the one live item filed under it, in any case or form, by its title or an alias", async () => {
    const { accountId, library } = await personalLibrary();
    const titled = await seedItem(accountId, { fields: noteFixture({ title: "Existing Title" }) });

    const aliased = await seedItem(accountId, {
      fields: noteFixture({ aliases: ["Nick"], title: "Named otherwise" }),
    });

    const accented = await seedItem(accountId, { fields: noteFixture({ title: "Café" }) });
    await seedItem(accountId, { fields: noteFixture({ title: "Twice" }) });
    await seedItem(accountId, { fields: noteFixture({ aliases: ["twice"], title: "Again" }) });

    const deleted = await seedItem(accountId, {
      fields: noteFixture({ deletedAt: SAVED_AT, title: "Gone" }),
    });

    await seedFile(accountId, PDF_SHA, { mime: "application/pdf" });

    const words = [
      "[[existing title]], [[NICK]], [[Café]], [[Twice]], [[Gone]] and [[Missing]].",
      `[Its old name](mention:${deleted.id})`,
      `![[assets/${PDF_SHA}/report.pdf]]`,
    ].join("\n\n");

    const saved = await library.items.saveLink({ note: words, url: "https://example.com/links" });
    const { blocks } = await library.items.get({ id: saved.item.id });
    expect(blocks.map(({ block }) => block.children)).toStrictEqual([
      [
        mention(titled.id, "Existing Title"),
        { text: ", " },
        mention(aliased.id, "Named otherwise"),
        { text: ", " },
        mention(accented.id, "Café"),
        { text: ", [[Twice]], [[Gone]] and [[Missing]]." },
      ],
      [mention(deleted.id, "Gone")],
      [{ text: "" }],
    ]);
    expect(blocks[2]?.block).toMatchObject({ name: "report.pdf", sha: PDF_SHA, type: "file" });
  });

  describe("the library's room", () => {
    it("refuses only a new item past the cap, saying what its files and bodies hold, and lets a full library tidy", async () => {
      const { accountId, library } = await personalLibrary();
      const { item: held } = await library.items.saveLink({ url: "https://example.com/kept" });
      const bytesCap = env.LIBRARY_STORAGE_CAP_BYTES;
      await seedFile(accountId, PDF_SHA, { bytes: bytesCap - 4, mime: "application/pdf" });
      await library.items.saveLink({ url: "https://example.com/the-last-one" });

      for (const refused of [
        async () => await library.items.saveLink({ url: "https://example.com/one-more" }),
        async () => await library.items.save(pageSave("https://example.com/a-page-more")),
        async () =>
          await library.items.create({
            blocks: [],
            folderId: null,
            id: newId(),
            savedAt: SAVED_AT,
            tags: [],
            title: "One more",
          }),
      ]) {
        await expect(refusalOf(refused())).resolves.toStrictEqual({
          code: "QUOTA",
          data: { bytesCap, bytesUsed: bytesCap },
          defined: true,
        });
      }

      await library.items.organize({ addTags: ["kept"], ids: [held.id], pinned: true });
      await library.write({
        itemId: held.id,
        ops: [{ key: "notes", op: "property", value: "y".repeat(8 * 1024) }],
      });
      await library.items.delete({ ids: [held.id] });
      await library.items.restore({ ids: [held.id] });
      await expect(
        library.items.saveLink({ url: "https://example.com/kept" }),
      ).resolves.toMatchObject({ created: false, item: { id: held.id } });
    });
  });

  it("saves a link through /v1/rpc as the extension sends it", async () => {
    const { cookie } = await signUpUser("library-save-link@example.test");
    const extension = v1Link(extensionHeaders(cookie));
    const saved = await extension.library.items.saveLink({ url: "https://example.com/" });
    expect(saved).toMatchObject({
      created: true,
      item: { fields: { reading: { state: "pending" } } },
    });
    await expect(fillJobs(await userIdOf(cookie))).resolves.toMatchObject([
      { id: `fill:${saved.item.id}`, kind: "fill" },
    ]);
  });
});
