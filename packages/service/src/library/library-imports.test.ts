import { randomUUID } from "node:crypto";

import { blankItemFields, importedFields } from "@repo/contract/library/item-makes";
import { BULK_ITEMS_MAX } from "@repo/contract/library/library-wire";
import { paragraph, pillParagraph } from "@repo/contract/test-support/library-items.test-utils";
import { db } from "@repo/db/drizzle-client";
import { changeSet, item, itemLink, job } from "@repo/db/library-schema";
import { dbSuite } from "@repo/db/test-database";
import { importPlannedDoc, openPlan, planImport } from "@repo/editor/headless/codec/import-plan";
import type { ImportEntry } from "@repo/editor/headless/codec/import-plan";
import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { env } from "../env";
import {
  libraryAs,
  makeAccount,
  personalLibrary,
  seedFile,
  sessionPrincipal,
} from "../test-support/library.fixture";
import { mintLibraryId } from "./library-ids";

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

type ImportedItem = Parameters<Library["imports"]["land"]>[0]["items"][number];

const SHA = "d".repeat(64);
const ORIGINAL = "e".repeat(64);
const LOOSE = "f".repeat(64);

const newId = () => mintLibraryId(Date.now());

const fieldsOf = (title: string, url: string | null = null) =>
  importedFields({ ...blankItemFields(Date.UTC(2026, 9, 1)), title, url });

const note = (
  title: string,
  more: { readonly folder?: string; readonly url?: string; readonly id?: string } = {},
) => ({
  blocks: [{ block: paragraph(randomUUID(), `${title}'s words.`), section: "note" as const }],
  cover: null,
  fields: fieldsOf(title, more.url ?? null),
  folder: more.folder ?? null,
  id: more.id ?? newId(),
  kind: "new" as const,
});

const titles = async (accountId: string) => {
  const rows = await db
    .select({ title: item.title })
    .from(item)
    .where(and(eq(item.accountId, accountId), isNull(item.deletedAt), ne(item.kind, "folder")))
    .orderBy(asc(item.title));

  return rows.map((row) => row.title);
};

const land = async (library: Library, items: readonly ImportedItem[]) =>
  await library.imports.land({ items: [...items] });

dbSuite("an import", () => {
  describe("how its notes stand", () => {
    it("answers a note the library holds by its id or its address, one in Deleted, and one new", async () => {
      const { library } = await personalLibrary();
      const held = note("Held");
      const deleted = note("Deleted");
      await land(library, [held, deleted, note("Linked", { url: "https://a.example/page" })]);
      await library.items.delete({ ids: [deleted.id] });
      const fresh = newId();

      const { notes } = await library.imports.settle({
        notes: [
          { id: held.id, url: null },
          { id: deleted.id, url: null },
          { id: fresh, url: "https://a.example/page?utm_source=x" },
          { id: newId(), url: null },
        ],
      });

      expect(notes.slice(0, 2)).toStrictEqual([
        { id: held.id, standing: "held" },
        { id: deleted.id, standing: "deleted" },
      ]);
      expect(notes[2]).toMatchObject({ standing: "held" });
      expect(notes[2]?.id).not.toBe(fresh);
      expect(notes[3]).toMatchObject({ standing: "new" });
    });

    it("gives a note whose id a purged item kept a fresh one", async () => {
      const { library } = await personalLibrary();
      const gone = note("Gone");
      await land(library, [gone]);
      await library.items.delete({ ids: [gone.id] });
      await library.items.purge({ ids: [gone.id] });
      const { notes } = await library.imports.settle({ notes: [{ id: gone.id, url: null }] });
      expect(notes[0]?.standing).toBe("new");
      expect(notes[0]?.id).not.toBe(gone.id);
    });
  });

  describe("a batch", () => {
    it("lands every item it adds, keeping no change set, in the folders its paths name", async () => {
      const { accountId, library } = await personalLibrary();

      for (const title of ["Alpha", "Beta"]) {
        await land(library, [note(title, { folder: "Projects/Specs" })]);
      }

      await expect(titles(accountId)).resolves.toStrictEqual(["Alpha", "Beta"]);
      await expect(
        db.select().from(changeSet).where(eq(changeSet.accountId, accountId)),
      ).resolves.toStrictEqual([]);

      const folders = await db
        .select({ name: item.title })
        .from(item)
        .where(and(eq(item.accountId, accountId), eq(item.kind, "folder")))
        .orderBy(asc(item.title));

      expect(folders.map((row) => row.name)).toStrictEqual(["Projects", "Specs"]);
    });

    it("asks for the page of each link it lands unread, and kicks the drain that reads it", async () => {
      const accountId = await makeAccount();
      const kickJobs = vi.fn<(kicked: string) => void>();
      const library = libraryAs(sessionPrincipal(accountId), kickJobs);

      const link = {
        ...note("A page"),
        cover: "https://a.example/cover.png",
        fields: {
          ...fieldsOf("A page", "https://a.example/page"),
          reading: { at: null, state: "pending" as const },
        },
      };

      await land(library, [link, note("A note")]);
      expect(kickJobs.mock.calls).toStrictEqual([[accountId]]);
      await expect(
        db
          .select({ id: job.id, payload: job.payload })
          .from(job)
          .where(eq(job.accountId, accountId)),
      ).resolves.toStrictEqual([
        {
          id: `fill:${link.id}`,
          payload: { coverHint: link.cover, itemId: link.id, url: "https://a.example/page" },
        },
      ]);
    });

    it("counts an item it holds by id or address, and brings one back from Deleted", async () => {
      const { accountId, library } = await personalLibrary();
      const held = note("Held", { url: "https://a.example/held" });
      const deleted = note("Deleted");
      await land(library, [held, deleted]);
      await library.items.delete({ ids: [deleted.id] });
      await expect(
        land(library, [
          held,
          note("Same page", { url: "https://a.example/held" }),
          { id: deleted.id, kind: "restore" },
        ]),
      ).resolves.toStrictEqual({ added: 1, alreadySaved: 2, unreadable: 0 });
      await expect(titles(accountId)).resolves.toStrictEqual(["Deleted", "Held"]);
    });

    it("lands a pill showing what its source gives, whatever display the batch sent", async () => {
      const { library } = await personalLibrary();
      const sum = pillParagraph(randomUUID(), "2+2", "5");
      const made = { ...note("Sums"), blocks: [{ block: sum, section: "note" as const }] };
      await land(library, [made]);
      await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
        blocks: [{ block: pillParagraph(sum.id, "2+2", "4"), section: "note" }],
        card: { preview: "4" },
      });
    });

    it("counts an item a rule refuses as unreadable, and lands the rest", async () => {
      const { accountId, library } = await personalLibrary();
      const refused = note("Refused");
      await expect(
        land(library, [{ ...refused, fields: { ...refused.fields, coverSha: SHA } }, note("Kept")]),
      ).resolves.toStrictEqual({ added: 1, alreadySaved: 0, unreadable: 1 });
      await expect(titles(accountId)).resolves.toStrictEqual(["Kept"]);
    });

    it("refuses the whole batch once the library is full, landing none of it", async () => {
      const { accountId, library } = await personalLibrary();
      await land(library, [note("Before")]);
      await seedFile(accountId, SHA, { bytes: env.LIBRARY_STORAGE_CAP_BYTES - 4096 });
      const long = note("Long");
      await expect(
        land(library, [
          note("Small"),
          {
            ...long,
            blocks: [{ block: paragraph("long", "y".repeat(8 * 1024)), section: "note" }],
          },
        ]),
      ).rejects.toMatchObject({ code: "QUOTA" });
      await expect(titles(accountId)).resolves.toStrictEqual(["Before"]);
    });
  });

  it("answers which of its files a live item names, and which one holds as its own original", async () => {
    const { accountId, library } = await personalLibrary();

    for (const sha of [SHA, ORIGINAL, LOOSE]) {
      await seedFile(accountId, sha);
    }

    const covered = note("Covered");
    await land(library, [
      { ...covered, fields: { ...covered.fields, coverSha: SHA } },
      {
        ...note("picture"),
        blocks: [],
        fields: {
          ...fieldsOf("picture"),
          kind: "image",
          originalName: "picture.png",
          originalSha: ORIGINAL,
        },
      },
    ]);
    const answer = await library.imports.named({ shas: [SHA, ORIGINAL, LOOSE] });
    expect(new Set(answer.named)).toStrictEqual(new Set([SHA, ORIGINAL]));
    expect(answer.originals).toStrictEqual([ORIGINAL]);
  });

  it(
    "lands a folder of 1,000 markdown notes read by the editor's codec, and lands none twice",
    { timeout: 120_000 },
    async () => {
      const { accountId, library } = await personalLibrary();

      const entries: ImportEntry[] = Array.from({ length: 1000 }, (_, at) => ({
        kind: "doc",
        path: `Vault/Area ${String(at % 10)}/Note ${String(at)}.md`,
        text: [
          "---",
          "tags: [imported]",
          "---",
          `# Note ${String(at)}`,
          "",
          at === 0 ? "The first note." : `Follows [[Note ${String(at - 1)}]].`,
          "",
          "- a point",
          "- another point",
          "",
        ].join("\n"),
      }));

      const texts = new Map(
        entries.map((entry) => [entry.path, entry.kind === "doc" ? entry.text : ""]),
      );

      const plan = planImport(entries, { newItemId: () => newId() });

      const settle = async () => {
        const settled = [];

        for (let at = 0; at < plan.docs.length; at += BULK_ITEMS_MAX) {
          const docs = plan.docs.slice(at, at + BULK_ITEMS_MAX);

          const { notes } = await library.imports.settle({
            notes: docs.map((doc) => ({ id: doc.itemId, url: doc.url })),
          });

          settled.push(...notes);
        }

        return settled;
      };

      const standings = await settle();
      expect(standings.every(({ standing }) => standing === "new")).toBe(true);
      const reader = openPlan(plan);

      const items = plan.docs.map((doc) => {
        const read = importPlannedDoc(reader, doc, texts.get(doc.path) ?? "", {
          newBlockId: () => randomUUID(),
          now: Date.now(),
        });

        if (!read.ok) {
          throw new Error(`${doc.path} could not be read`);
        }

        return {
          blocks: [...read.read.item.blocks],
          cover: null,
          fields: read.read.item.fields,
          folder: doc.path.split("/").slice(0, -1).join("/"),
          id: doc.itemId,
          kind: "new",
        } satisfies ImportedItem;
      });

      const counts = { added: 0, alreadySaved: 0, unreadable: 0 };

      for (let at = 0; at < items.length; at += BULK_ITEMS_MAX) {
        const landed = await land(library, items.slice(at, at + BULK_ITEMS_MAX));
        counts.added += landed.added;
        counts.alreadySaved += landed.alreadySaved;
        counts.unreadable += landed.unreadable;
      }

      expect(counts).toStrictEqual({ added: 1000, alreadySaved: 0, unreadable: 0 });

      const [held] = await db
        .select({ n: count() })
        .from(item)
        .where(and(eq(item.accountId, accountId), ne(item.kind, "folder")));

      expect(held?.n).toBe(1000);

      const [links] = await db
        .select({ n: count() })
        .from(itemLink)
        .where(eq(itemLink.accountId, accountId));

      expect(links?.n).toBe(999);

      const folders = await db
        .select()
        .from(item)
        .where(and(eq(item.accountId, accountId), eq(item.kind, "folder")));

      expect(folders).toHaveLength(11);

      const tagged = await library.listing.page({
        limit: 1,
        scope: { kind: "tag", tag: "imported" },
      });

      expect(tagged.total).toBe(1000);

      const again = await settle();
      expect(again.every(({ standing }) => standing === "held")).toBe(true);
      const [first] = items;

      if (first === undefined) {
        throw new Error("no item read");
      }

      await expect(land(library, [first])).resolves.toStrictEqual({
        added: 0,
        alreadySaved: 1,
        unreadable: 0,
      });
    },
  );
});
