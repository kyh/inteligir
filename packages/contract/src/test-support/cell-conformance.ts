// The cases every cell answers alike: the account's own, which the service runs them over in
// workerd (`packages/service/src/library/cell-conformance.test.ts`), and the fake cell a client's
// suites drive (`./fake-cell.test.ts`). Each is written over the library's procedures as a laptop
// calls them and nothing one host alone has, so a fake that drifts from the cell fails here, in
// its own package. A search's ranking, a folder filed by its path, an item's markdown and a sweep's
// landing, which is the alarm's, are the real cell's alone.

import { describe, expect, it } from "vitest";

import type { BodyBlock } from "../library/derive-item";
import { newIdSchema } from "../library/library-wire";
import type { LibraryBlock } from "../library/library-nodes";
import type { V1Client } from "../rpc/v1-contract";
import { isOrpcError } from "../rpc/v1-errors";
import { paragraph } from "./library-items";

type Library = V1Client["library"];

// a fresh library for as long as `run` takes: the real cell's client cannot leave its object
type WithLibrary = (run: (library: Library) => Promise<void>) => Promise<void>;

const SAVED_AT = 1_700_000_000_000;
const SHA = "a".repeat(64);
const OP_ID = "0190a000-0000-7000-8000-0000000000aa";
const FACTS = { author: null, description: null, lang: null, published: null, site: null };

const idOf = (n: number): string => `0190a000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

// the refusal a call met, as its client reads it
const refusalOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (isOrpcError(error)) {
      return { code: error.code, data: error.data };
    }
    throw error;
  }
  throw new Error("the call landed what the test expected it to refuse");
};

const codeOf = async (call: Promise<unknown>): Promise<string> => {
  const { code } = await refusalOf(call);
  return code;
};

interface Filing {
  readonly title?: string;
  readonly tags?: string[];
}

// what a laptop makes in a library: fresh ids, a note of lines of text, and a page it read
const laptopOn = (library: Library) => {
  let next = 0;
  const newId = (): string => {
    next += 1;
    return idOf(next);
  };
  const noteOf = (lines: readonly string[], filing: Filing = {}) => {
    const id = newId();
    return {
      blocks: lines.map((text, at): BodyBlock => ({
        block: paragraph(`${id}-${String(at)}`, text),
        section: "note",
      })),
      folderId: null,
      id,
      savedAt: SAVED_AT + next,
      tags: filing.tags ?? [],
      title: filing.title ?? "",
    };
  };
  const note = async (lines: readonly string[], filing?: Filing): Promise<string> => {
    const made = noteOf(lines, filing);
    await library.items.create(made);
    return made.id;
  };
  const page = (url: string, article: LibraryBlock[], tags: string[] = []) => ({
    article,
    coverSha: null,
    facts: { ...FACTS, site: "example.com" },
    folderId: null,
    id: newId(),
    savedAt: SAVED_AT,
    tags,
    title: "A page",
    url,
  });
  return { library, newId, note, noteOf, page };
};

type Laptop = ReturnType<typeof laptopOn>;

export const cellConformance = (withLibrary: WithLibrary): void => {
  const withLaptop = async (act: (laptop: Laptop) => Promise<void>): Promise<void> => {
    await withLibrary(async (library) => {
      await act(laptopOn(library));
    });
  };

  describe("what a client reads of a cell", () => {
    it("answers an item whole in reading order and its row without its body, one in Deleted too, and none it lacks", async () => {
      await withLaptop(async ({ library, newId, noteOf }) => {
        const made = noteOf(["First line.", "Second line."], { title: "Two lines" });
        const { id } = made;
        await library.items.create(made);
        const { blocks, ...row } = await library.items.get({ id });
        expect(row).toMatchObject({ fields: { kind: "note", title: "Two lines" }, id });
        expect(blocks.map(({ block }) => block.id)).toStrictEqual([`${id}-0`, `${id}-1`]);
        expect(row.seq).toBeGreaterThan(0);
        await expect(library.items.row({ id })).resolves.toStrictEqual(row);

        await library.items.delete({ ids: [id] });
        await expect(library.items.get({ id })).resolves.toMatchObject({
          fields: { deletedAt: expect.any(Number) },
        });
        const stranger = newId();
        await expect(codeOf(library.items.get({ id: stranger }))).resolves.toBe("NOT_FOUND");
        await expect(codeOf(library.items.row({ id: stranger }))).resolves.toBe("NOT_FOUND");
      });
    });

    it("lists every tag an item carries, its field's and its body's, each spelling once", async () => {
      await withLaptop(async ({ library, note }) => {
        const id = await note(["Weeding the #garden, #garden again."], { tags: ["Work"] });
        const page = await library.listing.page({ limit: 10, scope: { kind: "all" } });
        expect(page.items).toMatchObject([{ id, tags: ["Work", "garden"] }]);
      });
    });

    it("searches the live side for an item's exact text in any case, with the passage that matched", async () => {
      await withLaptop(async ({ library, note }) => {
        const gone = await note(["A fox long gone."]);
        await library.items.delete({ ids: [gone] });
        const kept = await note(["The fox naps in the sun."]);
        await note(["The dog barks."]);

        const live = await library.listing.page({
          limit: 10,
          scope: { kind: "all" },
          words: "FOX",
        });
        expect(live.items.map(({ id }) => id)).toStrictEqual([kept]);
        expect(live.items[0]?.snippet).toContain("fox");
      });
    });
  });

  describe("what a screen writes of a cell beyond its ops", () => {
    it("mints an id as a device does for a link saved without one", async () => {
      await withLaptop(async ({ library }) => {
        const { created, item } = await library.items.saveLink({ url: "https://example.com/a" });
        expect(created).toBe(true);
        expect(newIdSchema.safeParse(item.id).success).toBe(true);
        const again = await library.items.saveLink({ url: "https://example.com/b" });
        expect(again.item.id).not.toBe(item.id);
      });
    });

    it("organizes: tags case by case, a folder by its id, a pin and a title, and answers every tag the item carries", async () => {
      await withLaptop(async ({ library, newId, note }) => {
        const reading = newId();
        await library.folders.write({
          ops: [{ id: reading, name: "Reading", op: "create", parentId: null, sort: "a0" }],
        });
        const id = await note(["Plans for #later."], { tags: ["Spring", "trips"], title: "Plans" });

        const { items } = await library.items.organize({
          addTags: ["SPRING", "plans"],
          folder: { id: reading },
          ids: [id],
          pinned: true,
          removeTags: ["TRIPS"],
          title: "Trip",
        });

        expect(items).toMatchObject([
          {
            folderId: reading,
            id,
            pinned: true,
            tags: ["Spring", "later", "plans"],
            title: "Trip",
          },
        ]);
        await expect(library.items.get({ id })).resolves.toMatchObject({
          fields: { folderId: reading, tags: ["Spring", "plans"], title: "Trip" },
        });
      });
    });

    it("refuses an organize naming an item or a folder it lacks, landing none of it", async () => {
      await withLaptop(async ({ library, newId, note }) => {
        const id = await note(["Kept."], { title: "Kept" });

        await expect(
          codeOf(library.items.organize({ ids: [id, newId()], pinned: true })),
        ).resolves.toBe("NOT_FOUND");
        await expect(
          codeOf(library.items.organize({ folder: { id: newId() }, ids: [id] })),
        ).resolves.toBe("NOT_FOUND");
        await expect(library.items.get({ id })).resolves.toMatchObject({
          fields: { folderId: null, pinnedAt: null },
        });
      });
    });

    it("deletes and restores items, naming the ids it could not change, and moves none already there", async () => {
      await withLaptop(async ({ library, newId, note }) => {
        const id = await note(["Soon gone."]);
        const nobody = newId();
        await expect(library.items.delete({ ids: [id, nobody] })).resolves.toStrictEqual({
          deleted: [id],
          missing: [nobody],
        });
        const gone = await library.items.row({ id });
        await expect(library.items.delete({ ids: [id] })).resolves.toStrictEqual({
          deleted: [id],
          missing: [],
        });
        await expect(library.items.row({ id })).resolves.toStrictEqual(gone);

        await expect(library.items.restore({ ids: [id, nobody] })).resolves.toStrictEqual({
          addressHeld: [],
          missing: [nobody],
          restored: [id],
        });
        await expect(library.items.row({ id })).resolves.toMatchObject({
          fields: { deletedAt: null },
        });
      });
    });

    it("leaves in Deleted an item whose address another item holds now, and says which", async () => {
      await withLaptop(async ({ library }) => {
        const url = "https://example.com/held";
        const { item: first } = await library.items.saveLink({ url });
        await library.items.delete({ ids: [first.id] });
        await library.items.saveLink({ url });
        await expect(library.items.restore({ ids: [first.id] })).resolves.toStrictEqual({
          addressHeld: [first.id],
          missing: [],
          restored: [],
        });
      });
    });

    it("empties Deleted for good, counts any other id missing, and never makes a purged id again", async () => {
      await withLaptop(async ({ library, newId, note, noteOf }) => {
        const made = noteOf(["Gone."]);
        await library.items.create(made);
        const kept = await note(["Kept."]);
        await library.items.delete({ ids: [made.id] });
        const stranger = newId();

        await expect(
          library.items.purge({ ids: [made.id, kept, stranger] }),
        ).resolves.toStrictEqual({ missing: [kept, stranger], purged: [made.id] });
        await expect(codeOf(library.items.get({ id: made.id }))).resolves.toBe("NOT_FOUND");
        await expect(codeOf(library.items.row({ id: made.id }))).resolves.toBe("NOT_FOUND");
        await expect(library.listing.scopes()).resolves.toMatchObject({ deleted: 0, total: 1 });
        await expect(codeOf(library.items.create(made))).resolves.toBe("CONFLICT");
      });
    });

    it("reads a link's page again, and has no page to read for a note", async () => {
      await withLaptop(async ({ library, note }) => {
        const { item } = await library.items.saveLink({ url: "https://example.com/page" });
        const id = await note(["Mine."]);

        await expect(library.items.refresh({ id: item.id })).resolves.toMatchObject({
          item: { fields: { reading: { at: null, state: "pending" } }, id: item.id },
        });
        await expect(codeOf(library.items.refresh({ id }))).resolves.toBe("NOT_FOUND");
      });
    });

    it("answers a save of an address it holds with that item as it stands", async () => {
      await withLaptop(async ({ library, page }) => {
        const url = "https://example.com/fox";
        const first = await library.items.save(
          page(url, [paragraph("p1", "The fox jumps.")], ["animals"]),
        );
        expect(first).toMatchObject({ created: true, item: { fields: { tags: ["animals"] } } });

        const held = { created: false, item: first.item };
        await expect(
          library.items.save(
            page(`${url}#top`, [paragraph("p2", "Now the fox naps.")], ["Animals", "dogs"]),
          ),
        ).resolves.toStrictEqual(held);
        await expect(
          library.items.saveLink({ note: "Read this one first.", url }),
        ).resolves.toStrictEqual(held);
        const whole = await library.items.get({ id: first.item.id });
        expect(whole.blocks).toMatchObject([{ block: { id: "p1" }, section: "article" }]);
      });
    });

    it("lands a device's read on a held link still waiting for its page, the name the person gave kept", async () => {
      await withLaptop(async ({ library, page }) => {
        const url = "https://example.com/saved-later";
        const stub = await library.items.saveLink({ title: "My name for it", url });
        // a read that found no article leaves the link to the cloud's
        await expect(library.items.save(page(url, []))).resolves.toStrictEqual({
          created: false,
          item: stub.item,
        });

        const landed = await library.items.save({
          ...page(url, [paragraph("p1", "The fox jumps.")], ["animals"]),
          facts: { ...FACTS, author: "A. Writer" },
          note: "Words the read brought.",
        });
        expect(landed).toMatchObject({
          created: false,
          item: {
            fields: {
              author: "A. Writer",
              reading: { state: "read" },
              tags: [],
              title: "My name for it",
            },
            id: stub.item.id,
          },
        });
        const whole = await library.items.get({ id: stub.item.id });
        expect(whole.blocks).toMatchObject([{ block: { id: "p1" }, section: "article" }]);

        // read now, so a later device's read leaves it as it stands
        await expect(
          library.items.save(page(url, [paragraph("p2", "Now the fox naps.")])),
        ).resolves.toStrictEqual({ created: false, item: landed.item });
      });
    });

    it("refuses a file whose bytes were never uploaded", async () => {
      await withLaptop(async ({ library, newId }) => {
        await expect(
          refusalOf(
            library.items.createFile({
              folderId: null,
              id: newId(),
              name: "photo.png",
              savedAt: SAVED_AT,
              sha: SHA,
              tags: [],
            }),
          ),
        ).resolves.toStrictEqual({ code: "BLOB_MISSING", data: { shas: [SHA] } });
      });
    });

    it("answers a resend by its op id with what the first call answered, and an id made twice without one as a conflict", async () => {
      await withLaptop(async ({ library, noteOf }) => {
        const made = noteOf(["Once."]);
        const first = await library.items.create({ ...made, opId: OP_ID });
        await expect(library.items.create({ ...made, opId: OP_ID })).resolves.toStrictEqual(first);
        await expect(codeOf(library.items.create(made))).resolves.toBe("CONFLICT");
        await expect(library.listing.scopes()).resolves.toMatchObject({ total: 1 });
      });
    });
  });
};
