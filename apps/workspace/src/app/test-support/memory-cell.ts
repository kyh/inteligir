// An account's library cell in memory, for a suite that draws the whole page: it keeps items and
// folders and answers the page's reads and writes over them by procedure, as `fakePageLibrary`'s
// `answer` takes them. It keeps only what the page leans on: a write lands on the bases it names
// (`@repo/notes/library/block-ops`) or answers CONFLICT, the card is derived as the cell derives it,
// and a listing answers its scope in one page.

import { createORPCErrorFromJson } from "@orpc/client";
import { listingQuerySchema } from "@repo/contract/cloud/library/library-wire";
import { applyOps, libraryOpSchema } from "@repo/notes/library/block-ops";
import type { StoredBlock } from "@repo/notes/library/block-ops";
import { blockHash } from "@repo/notes/library/block-hash";
import { deriveItem } from "@repo/notes/library/derive-item";
import { noteFields, stubFields } from "@repo/notes/library/item-makes";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { storableBlockSchema } from "@repo/notes/library/library-nodes";
import { z } from "zod";

import type { ListedItem, ListingQuery } from "../library/listing";
import { newId } from "../library/new-id";
import type { CellCall } from "./fake-page-library";

interface Held {
  readonly fields: LibraryItemFields;
  readonly blocks: ReadonlyMap<string, StoredBlock>;
  readonly seq: number;
}

interface Folder {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly sort: string;
}

const SAVED = 1_700_000_000_000;

const idsInput = z.object({ ids: z.array(z.string()) });
const idInput = z.object({ id: z.string() });
const pageInput = z.object({ query: listingQuerySchema });
const createInput = z.object({
  blocks: z.array(z.object({ block: storableBlockSchema, ord: z.string() })),
  folderId: z.string().nullable(),
  id: z.string(),
  tags: z.array(z.string()),
  title: z.string(),
});
const saveLinkInput = z.object({
  folder: z.object({ id: z.string() }).nullable().optional(),
  tags: z.array(z.string()).optional(),
  title: z.string().optional(),
  url: z.string(),
});
const organizeInput = z.object({
  addTags: z.array(z.string()).optional(),
  folder: z.object({ id: z.string() }).nullable().optional(),
  ids: z.array(z.string()),
  pinned: z.boolean().optional(),
  removeTags: z.array(z.string()).optional(),
  title: z.string().optional(),
});
const writeInput = z.object({ itemId: z.string(), ops: z.array(libraryOpSchema) });

const cardOf = ({ fields, blocks }: Held): ListedItem["card"] => {
  const { card } = deriveItem(fields, blocks);
  return { ...card, outline: [...card.outline] };
};

const pinnedAt = (pinned: boolean | undefined, was: number | null): number | null => {
  if (pinned === undefined) {
    return was;
  }
  return pinned ? SAVED : null;
};

const refused = (code: "CONFLICT" | "NOT_FOUND") =>
  createORPCErrorFromJson({ code, data: undefined, defined: true, message: code });

export const memoryCell = () => {
  const items = new Map<string, Held>();
  const folders: Folder[] = [];
  let head = 0;

  const put = (id: string, fields: LibraryItemFields, blocks: Held["blocks"] = new Map()) => {
    head += 1;
    items.set(id, { blocks, fields, seq: head });
  };

  const listed = (id: string, held: Held): ListedItem => ({
    card: cardOf(held),
    fields: held.fields,
    id,
    seq: held.seq,
    tags: held.fields.tags,
    updatedAt: SAVED,
  });

  const live = (id: string) => {
    const held = items.get(id);
    if (held === undefined) {
      throw refused("NOT_FOUND");
    }
    return { ...listed(id, held), kind: "live" as const };
  };

  const change = (
    ids: readonly string[],
    patch: (fields: LibraryItemFields) => LibraryItemFields,
  ) =>
    ids.filter((id) => {
      const held = items.get(id);
      if (held !== undefined) {
        put(id, patch(held.fields), held.blocks);
      }
      return held !== undefined;
    });

  const page = (query: ListingQuery) => {
    const rows = [...items]
      .filter(
        ([, { fields }]) =>
          (fields.deletedAt !== null) === query.deleted &&
          (query.folderId === undefined || fields.folderId === query.folderId) &&
          (query.tag === undefined || fields.tags.includes(query.tag)),
      )
      .map(([id, held]) => listed(id, held));
    return { items: rows, kindCounts: {}, nextCursor: null, total: rows.length };
  };

  const scopes = () => {
    const kept = [...items.values()].filter(({ fields }) => fields.deletedAt === null);
    const tags = [...new Set(kept.flatMap(({ fields }) => fields.tags))];
    return {
      deleted: items.size - kept.length,
      folders: folders.map((folder) => ({
        ...folder,
        items: kept.filter(({ fields }) => fields.folderId === folder.id).length,
      })),
      tags: tags.map((tag) => ({
        items: kept.filter(({ fields }) => fields.tags.includes(tag)).length,
        tag,
      })),
      total: kept.length,
      unsorted: kept.filter(({ fields }) => fields.folderId === null).length,
      untagged: kept.filter(({ fields }) => fields.tags.length === 0).length,
    };
  };

  const write = ({ itemId, ops }: z.infer<typeof writeInput>) => {
    const held = items.get(itemId);
    if (held === undefined) {
      throw refused("NOT_FOUND");
    }
    const outcome = applyOps(held, ops);
    if (outcome.kind !== "applied") {
      throw refused("CONFLICT");
    }
    put(itemId, outcome.state.fields, outcome.state.blocks);
    return { item: live(itemId) };
  };

  const answer = ({ path, input }: CellCall) => {
    switch (path) {
      case "library.listing.page": {
        return page(pageInput.parse(input).query);
      }
      case "library.listing.scopes": {
        return scopes();
      }
      case "library.items.get": {
        const held = items.get(idInput.parse(input).id);
        return { ...live(idInput.parse(input).id), blocks: [...(held?.blocks.values() ?? [])] };
      }
      case "library.items.create": {
        const note = createInput.parse(input);
        const blocks = new Map(
          note.blocks.map(({ block, ord }): [string, StoredBlock] => [
            block.id,
            { block, hash: blockHash(block), ord, section: "note" },
          ]),
        );
        put(note.id, noteFields({ ...note, savedAt: SAVED }), blocks);
        return { item: live(note.id) };
      }
      case "library.items.saveLink": {
        const link = saveLinkInput.parse(input);
        const id = newId();
        put(
          id,
          stubFields({
            folderId: link.folder?.id ?? null,
            savedAt: SAVED,
            tags: link.tags ?? [],
            title: link.title,
            url: link.url,
          }),
        );
        return { created: true, item: live(id) };
      }
      case "library.items.organize": {
        const asked = organizeInput.parse(input);
        const off = new Set(asked.removeTags);
        const moved = change(asked.ids, (fields) => ({
          ...fields,
          folderId: asked.folder === undefined ? fields.folderId : (asked.folder?.id ?? null),
          pinnedAt: pinnedAt(asked.pinned, fields.pinnedAt),
          tags: [...new Set([...fields.tags, ...(asked.addTags ?? [])])].filter(
            (tag) => !off.has(tag),
          ),
          title: asked.title ?? fields.title,
        }));
        return { items: moved.map((id) => ({ id })) };
      }
      case "library.items.delete": {
        const { ids } = idsInput.parse(input);
        return { deleted: change(ids, (fields) => ({ ...fields, deletedAt: SAVED })), missing: [] };
      }
      case "library.items.restore": {
        const { ids } = idsInput.parse(input);
        const restored = change(ids, (fields) => ({ ...fields, deletedAt: null }));
        return { addressHeld: [], missing: [], restored };
      }
      case "library.items.purge": {
        const { ids } = idsInput.parse(input);
        const purged = ids.filter((id) => items.delete(id));
        return { missing: [], purged };
      }
      case "library.write": {
        return write(writeInput.parse(input));
      }
      default: {
        return {};
      }
    }
  };

  return {
    answer,
    folder: (folder: Folder) => {
      folders.push(folder);
    },
    item: (id: string) => items.get(id) ?? null,
    note: (title: string, patch: Partial<LibraryItemFields> = {}) => {
      const id = newId();
      put(id, { ...noteFields({ folderId: null, savedAt: SAVED, tags: [], title }), ...patch });
      return id;
    },
  };
};
