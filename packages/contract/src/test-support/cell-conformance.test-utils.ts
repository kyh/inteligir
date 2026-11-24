import { describe, expect, it } from "vitest";

import type { BodyBlock } from "../library/derive-item";
import { ITEM_FIELD_CAPS } from "../items/item-field-caps";
import { newIdSchema } from "../library/library-wire";
import type { LibraryBlock } from "../library/library-nodes";
import type { V1Client } from "../rpc/v1-contract";
import { isOrpcError } from "../rpc/v1-errors";
import { paragraph } from "./library-items.test-utils";

type Library = V1Client["library"];

interface CellHost {
  readonly library: Library;
  readonly upload: (bytes: Uint8Array<ArrayBuffer>, mime: string) => Promise<string>;
  readonly runDue: () => Promise<void>;
}

type WithHost = (run: (host: CellHost) => Promise<void>) => Promise<void>;

const SAVED_AT = 1_700_000_000_000;
const SHA = "a".repeat(64);
const OP_ID = "0190a000-0000-7000-8000-0000000000aa";
const FACTS = { author: null, description: null, lang: null, published: null, site: null };
const PNG = "image/png";

const TAGS_AT_CAP = Array.from(
  { length: ITEM_FIELD_CAPS.listEntries },
  (_, at) => `t${String(at)}`,
);

const bytesOf = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

const pictureBlock = (id: string, sha: string) =>
  ({
    children: [{ text: "" }],
    id,
    sha,
    type: "img",
  }) satisfies LibraryBlock;

const pictureOf = (id: string, sha: string) =>
  ({
    block: pictureBlock(id, sha),
    section: "note",
  }) satisfies BodyBlock;

const idOf = (n: number) => `0190a000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

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

const codeOf = async (call: Promise<unknown>) => {
  const { code } = await refusalOf(call);

  return code;
};

interface Filing {
  readonly title?: string;
  readonly tags?: string[];
}

const laptopOn = (host: CellHost) => {
  const { library } = host;
  let next = 0;

  const newId = () => {
    next += 1;

    return idOf(next);
  };

  const noteOf = (lines: readonly string[], filing: Filing = {}) => {
    const id = newId();

    return {
      blocks: lines.map(
        (text, at) =>
          ({
            block: paragraph(`${id}-${String(at)}`, text),
            section: "note",
          }) satisfies BodyBlock,
      ),
      parentId: null,
      id,
      savedAt: SAVED_AT + next,
      tags: filing.tags ?? [],
      title: filing.title ?? "",
    };
  };

  const note = async (lines: readonly string[], filing?: Filing) => {
    const made = noteOf(lines, filing);
    await library.items.create(made);

    return made.id;
  };

  const page = (url: string, article: LibraryBlock[], tags: string[] = []) => ({
    article,
    coverSha: null,
    facts: { ...FACTS, site: "example.com" },
    parentId: null,
    id: newId(),
    savedAt: SAVED_AT,
    tags,
    title: "A page",
    url,
  });

  return { ...host, newId, note, noteOf, page };
};

type Laptop = ReturnType<typeof laptopOn>;

export const cellConformance = (withHost: WithHost) => {
  const withLaptop = async (act: (laptop: Laptop) => Promise<void>) => {
    await withHost(async (host) => {
      await act(laptopOn(host));
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

    it("searches Deleted for an item's exact text in any case, apart from the live side", async () => {
      await withLaptop(async ({ library, note }) => {
        const gone = await note(["A fox long gone."]);
        const dog = await note(["A dog long gone."]);
        await note(["The fox naps in the sun."]);
        await library.items.delete({ ids: [gone, dog] });

        const deleted = await library.listing.page({
          limit: 10,
          scope: { kind: "deleted" },
          words: "FOX",
        });

        expect(deleted.items.map(({ id }) => id)).toStrictEqual([gone]);
        expect(deleted.items[0]?.snippet).toContain("fox");
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
        await library.items.create({
          blocks: [],
          id: reading,
          kind: "folder",
          parentId: null,
          savedAt: 1,
          tags: [],
          title: "Reading",
        });
        const id = await note(["Plans for #later."], { tags: ["Spring", "trips"], title: "Plans" });

        const { items } = await library.items.organize({
          addTags: ["SPRING", "plans"],
          parent: { id: reading },
          ids: [id],
          pinned: true,
          removeTags: ["TRIPS"],
          title: "Trip",
        });

        expect(items).toMatchObject([
          {
            parentId: reading,
            id,
            pinned: true,
            tags: ["Spring", "later", "plans"],
            title: "Trip",
          },
        ]);
        await expect(library.items.get({ id })).resolves.toMatchObject({
          fields: { parentId: reading, tags: ["Spring", "plans"], title: "Trip" },
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
          codeOf(library.items.organize({ ids: [id], parent: { id: newId() } })),
        ).resolves.toBe("NOT_FOUND");
        await expect(library.items.get({ id })).resolves.toMatchObject({
          fields: { parentId: null, pinnedAt: null },
        });
      });
    });

    it("makes a list with a status to group by, renames a property across what it holds, and refuses a list's settings on anything else", async () => {
      await withLaptop(async ({ library, newId }) => {
        const list = newId();

        const make = async (
          id: string,
          kind: "folder" | "list" | "note",
          parentId: string | null,
        ) =>
          await library.items.create({
            blocks: [],
            id,
            kind,
            parentId,
            savedAt: 1,
            tags: [],
            title: kind,
          });

        const made = await make(list, "list", null);
        expect(made.item.fields.list).toMatchObject({ groupBy: "Status" });
        const task = newId();
        await make(task, "note", list);
        await library.write({
          itemId: task,
          ops: [{ key: "Status", op: "property", value: "Done" }],
        });

        const renamed = await library.items.setList({
          id: list,
          list: {
            groupBy: "Stage",
            properties: [
              {
                name: "Stage",
                options: [{ name: "To do" }, { name: "Done" }],
                type: "select",
              },
              { name: "Link", type: "url" },
            ],
          },
          renames: [{ from: "Status", to: "Stage" }],
        });

        expect(renamed.item.fields.list?.groupBy).toBe("Stage");
        await expect(library.items.get({ id: task })).resolves.toMatchObject({
          fields: { properties: { Stage: "Done" } },
        });

        const folder = newId();
        await make(folder, "folder", null);
        await expect(
          codeOf(library.items.setList({ id: folder, list: { groupBy: null, properties: [] } })),
        ).resolves.toBe("CONFLICT");
        await expect(
          codeOf(library.items.setList({ id: newId(), list: { groupBy: null, properties: [] } })),
        ).resolves.toBe("NOT_FOUND");
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

    it("answers a save of a held address it has read with that item, though the save names a cover never sent up", async () => {
      await withLaptop(async ({ library, page }) => {
        const url = "https://example.com/read";
        const first = await library.items.save(page(url, [paragraph("p1", "The fox jumps.")]));

        await expect(
          library.items.save({
            ...page(url, [paragraph("p2", "Now the fox naps.")]),
            coverSha: SHA,
          }),
        ).resolves.toStrictEqual({ created: false, item: first.item });
      });
    });

    it("saves a page with its cover once the cover's bytes are up, and refuses one whose bytes never were", async () => {
      await withLaptop(async ({ library, page, upload }) => {
        const url = "https://example.com/covered";
        const read = page(url, [paragraph("p1", "The fox jumps.")]);
        await expect(
          refusalOf(library.items.save({ ...read, coverSha: SHA })),
        ).resolves.toStrictEqual({ code: "BLOB_MISSING", data: { shas: [SHA] } });

        const cover = await upload(bytesOf("a cover"), PNG);
        await expect(library.items.save({ ...read, coverSha: cover })).resolves.toMatchObject({
          created: true,
          item: { fields: { coverSha: cover, url }, id: read.id },
        });
      });
    });

    it("lands a device's read with its cover on a held link waiting for its page, the cover's bytes checked as it lands", async () => {
      await withLaptop(async ({ library, page, upload }) => {
        const url = "https://example.com/covered-later";
        const stub = await library.items.saveLink({ url });
        const read = page(url, [paragraph("p1", "The fox jumps.")]);
        await expect(
          refusalOf(library.items.save({ ...read, coverSha: SHA })),
        ).resolves.toStrictEqual({ code: "BLOB_MISSING", data: { shas: [SHA] } });
        await expect(library.items.row({ id: stub.item.id })).resolves.toMatchObject(stub.item);

        const cover = await upload(bytesOf("a cover"), PNG);
        await expect(library.items.save({ ...read, coverSha: cover })).resolves.toMatchObject({
          created: false,
          item: { fields: { coverSha: cover, reading: { state: "read" } }, id: stub.item.id },
        });
      });
    });

    it("saves a page whose article shows a picture once the picture's bytes are up, new or on a held link, and refuses it before", async () => {
      await withLaptop(async ({ library, page, upload }) => {
        const url = "https://example.com/pictured";
        const unsent = [paragraph("p1", "The fox jumps."), pictureBlock("p2", SHA)];
        const missing = { code: "BLOB_MISSING", data: { shas: [SHA] } };
        await expect(refusalOf(library.items.save(page(url, unsent)))).resolves.toStrictEqual(
          missing,
        );
        const stub = await library.items.saveLink({ url });
        await expect(refusalOf(library.items.save(page(url, unsent)))).resolves.toStrictEqual(
          missing,
        );
        await expect(library.items.row({ id: stub.item.id })).resolves.toMatchObject(stub.item);

        const sha = await upload(bytesOf("a picture on the page"), PNG);
        await library.items.save(page(url, [pictureBlock("p2", sha)]));
        await expect(library.items.get({ id: stub.item.id })).resolves.toMatchObject({
          blocks: [{ block: { id: "p2", sha }, section: "article" }],
          fields: { reading: { state: "read" } },
        });
      });
    });

    it("lands a device's read on a held link still waiting for its page, the name the person gave kept", async () => {
      await withLaptop(async ({ library, page }) => {
        const url = "https://example.com/saved-later";
        const stub = await library.items.saveLink({ title: "My name for it", url });
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

        await expect(
          library.items.save(page(url, [paragraph("p2", "Now the fox naps.")])),
        ).resolves.toStrictEqual({ created: false, item: landed.item });
      });
    });

    it("makes a file of bytes sent up first, its kind by the type they were sent as, and refuses one whose bytes never were", async () => {
      await withLaptop(async ({ library, newId, upload }) => {
        const fileOf = (sha: string) => ({
          parentId: null,
          id: newId(),
          name: "pier.png",
          savedAt: SAVED_AT,
          sha,
          tags: [],
        });

        await expect(refusalOf(library.items.createFile(fileOf(SHA)))).resolves.toStrictEqual({
          code: "BLOB_MISSING",
          data: { shas: [SHA] },
        });

        const sha = await upload(bytesOf("a photo of the pier"), PNG);
        const made = fileOf(sha);
        await library.items.createFile(made);
        await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
          blocks: [],
          fields: {
            coverSha: sha,
            kind: "image",
            originalName: "pier.png",
            originalSha: sha,
            title: "pier",
          },
        });
      });
    });

    it("makes a note whose block names a file sent up first, and refuses one naming bytes never sent", async () => {
      await withLaptop(async ({ library, noteOf, upload }) => {
        const unsent = noteOf([]);
        await expect(
          refusalOf(
            library.items.create({ ...unsent, blocks: [pictureOf(`${unsent.id}-0`, SHA)] }),
          ),
        ).resolves.toStrictEqual({ code: "BLOB_MISSING", data: { shas: [SHA] } });

        const sha = await upload(bytesOf("a picture in a note"), PNG);
        const made = noteOf([]);
        await library.items.create({ ...made, blocks: [pictureOf(`${made.id}-0`, sha)] });
        await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
          blocks: [{ block: { id: `${made.id}-0`, sha, type: "img" }, section: "note" }],
        });
      });
    });

    it("saves a note's body that keeps the picture it shows, and refuses one adding a picture whose bytes never came up, naming that one alone", async () => {
      await withLaptop(async ({ library, noteOf, upload }) => {
        const sha = await upload(bytesOf("a picture kept"), PNG);
        const made = noteOf([]);
        const kept = pictureOf(`${made.id}-0`, sha);
        await library.items.create({ ...made, blocks: [kept] });

        const typed: BodyBlock = {
          block: paragraph(`${made.id}-1`, "Typed under it."),
          section: "note",
        };

        await expect(
          library.items.saveBody({ baseVersion: 1, blocks: [kept, typed], id: made.id }),
        ).resolves.toMatchObject({ kind: "saved", version: 2 });
        await expect(
          refusalOf(
            library.items.saveBody({
              baseVersion: 2,
              blocks: [kept, typed, pictureOf(`${made.id}-2`, SHA)],
              id: made.id,
            }),
          ),
        ).resolves.toStrictEqual({ code: "BLOB_MISSING", data: { shas: [SHA] } });
        await expect(library.items.get({ id: made.id })).resolves.toMatchObject({
          bodyVersion: 2,
        });
      });
    });

    it("refuses a landing past an item's caps, by a property and by an organize, landing none of it", async () => {
      await withLaptop(async ({ library, note }) => {
        const roomy = await note(["Room."]);
        const id = await note(["Full."], { tags: TAGS_AT_CAP });
        const before = await library.items.row({ id });
        const roomyBefore = await library.items.row({ id: roomy });

        await expect(
          codeOf(library.items.organize({ addTags: ["more"], ids: [roomy, id] })),
        ).resolves.toBe("PAYLOAD_TOO_LARGE");
        await expect(library.items.row({ id: roomy })).resolves.toStrictEqual(roomyBefore);
        await expect(
          codeOf(
            library.write({
              itemId: id,
              ops: [
                {
                  key: "notes",
                  op: "property",
                  value: "x".repeat(ITEM_FIELD_CAPS.propertiesBytes),
                },
              ],
            }),
          ),
        ).resolves.toBe("PAYLOAD_TOO_LARGE");
        await expect(library.items.row({ id })).resolves.toStrictEqual(before);
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

  describe("a sweep of a cell, read once its jobs ran", () => {
    it("organizes every item its scope lists but those left out, leaving a change of tags past an item's cap and saying so", async () => {
      await withLaptop(async ({ library, newId, note, runDue }) => {
        const reading = newId();
        await library.items.create({
          blocks: [],
          id: reading,
          kind: "folder",
          parentId: null,
          savedAt: 1,
          tags: [],
          title: "Reading",
        });
        const kept = await note(["Left out."], { tags: ["field"] });
        const swept = await note(["Swept."], { tags: ["field", "Spring"] });
        const full = await note(["Full."], { tags: TAGS_AT_CAP });

        await expect(
          library.items.sweep({
            except: [kept],
            scope: { kind: "all" },
            verb: {
              addTags: ["done"],
              parent: { id: reading },
              kind: "organize",
              pinned: true,
              removeTags: ["FIELD"],
            },
          }),
        ).resolves.toStrictEqual({ items: 2, refused: [full] });
        await runDue();

        const placed = { parentId: reading, pinnedAt: expect.any(Number) };
        await expect(library.items.get({ id: swept })).resolves.toMatchObject({
          fields: { ...placed, tags: ["Spring", "done"] },
        });
        await expect(library.items.get({ id: full })).resolves.toMatchObject({
          fields: { ...placed, tags: TAGS_AT_CAP },
        });
        await expect(library.items.get({ id: kept })).resolves.toMatchObject({
          fields: { parentId: null, pinnedAt: null, tags: ["field"] },
        });
      });
    });

    it("moves a scope to Deleted, back, and out of it for good, leaving in Deleted an item whose address another holds now", async () => {
      await withLaptop(async ({ library, note, page, runDue }) => {
        const kept = await note(["Left out."]);
        const swept = await note(["Swept."]);
        const url = "https://example.com/swept";
        const { item: first } = await library.items.save(page(url, [paragraph("p1", "First.")]));

        await expect(
          library.items.sweep({ except: [kept], scope: { kind: "all" }, verb: { kind: "delete" } }),
        ).resolves.toStrictEqual({ items: 2, refused: [] });
        await runDue();
        await expect(library.listing.scopes()).resolves.toMatchObject({ deleted: 2, total: 1 });

        await library.items.save(page(url, [paragraph("p2", "Second.")]));
        await expect(
          library.items.sweep({
            except: [],
            scope: { kind: "deleted" },
            verb: { kind: "restore" },
          }),
        ).resolves.toStrictEqual({ items: 2, refused: [first.id] });
        await runDue();
        await expect(library.listing.scopes()).resolves.toMatchObject({ deleted: 1, total: 3 });
        await expect(library.items.row({ id: swept })).resolves.toMatchObject({
          fields: { deletedAt: null },
        });

        await expect(
          library.items.sweep({ except: [], scope: { kind: "deleted" }, verb: { kind: "purge" } }),
        ).resolves.toStrictEqual({ items: 1, refused: [] });
        await runDue();
        await expect(library.listing.scopes()).resolves.toMatchObject({ deleted: 0, total: 3 });
        await expect(codeOf(library.items.get({ id: first.id }))).resolves.toBe("NOT_FOUND");
      });
    });

    it("brings back, of the items it restores at one address, only the one deleted last", async () => {
      await withLaptop(async ({ library, newId, page, runDue }) => {
        const url = "https://example.com/twice";
        const [later, earlier] = [newId(), newId()];
        await library.items.save({
          ...page(url, [paragraph("p1", "First.")]),
          id: earlier,
          savedAt: SAVED_AT + 1,
        });
        await library.items.delete({ ids: [earlier] });
        await library.items.save({ ...page(url, [paragraph("p2", "Second.")]), id: later });
        await library.items.delete({ ids: [later] });

        await expect(
          library.items.sweep({
            except: [],
            scope: { kind: "deleted" },
            verb: { kind: "restore" },
          }),
        ).resolves.toStrictEqual({ items: 2, refused: [earlier] });
        await runDue();
        await expect(library.items.row({ id: later })).resolves.toMatchObject({
          fields: { deletedAt: null },
        });
        await expect(library.items.row({ id: earlier })).resolves.toMatchObject({
          fields: { deletedAt: expect.any(Number) },
        });
      });
    });

    it("brings back, of the items a restore names at one address, only the one deleted last, whichever it names first", async () => {
      await withLaptop(async ({ library, newId, page }) => {
        const url = "https://example.com/named-twice";
        const [later, earlier] = [newId(), newId()];
        await library.items.save({ ...page(url, [paragraph("p1", "First.")]), id: earlier });
        await library.items.delete({ ids: [earlier] });
        await library.items.save({ ...page(url, [paragraph("p2", "Second.")]), id: later });
        await library.items.delete({ ids: [later] });

        await expect(library.items.restore({ ids: [earlier, later] })).resolves.toStrictEqual({
          addressHeld: [earlier],
          missing: [],
          restored: [later],
        });
      });
    });
  });
};
