// a file saved as an item: the original lands where a paste beside its wrapper would, under its own
// name, and the wrapper is a doc that embeds it, so search, History and sync treat it as any item.

import type { itemsSaveFileRequestSchema } from "@repo/contract/local/items/items-schema";
import { takesBytes } from "@repo/contract/local/vault/vault-schema";
import { embedMarkdown } from "@repo/notes/items/item-body";
import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import type { ItemFileFields } from "@repo/notes/items/item-frontmatter";
import { fileKindOf, ITEM_FILE_MAX_BYTES, UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import { itemNameFromTitle } from "@repo/notes/items/item-name";
import { formatItemTime } from "@repo/notes/items/item-time";
import { cleanUrl } from "@repo/notes/items/item-url";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import type { z } from "zod";

import type { ItemCore } from "./item-core";
import { ItemsError } from "./items-error";
import type { SaveOutcome } from "./items-service";

export type SaveFileInput = z.output<typeof itemsSaveFileRequestSchema>;

const FALLBACK_STEM = "File";

const withoutExtension = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

export const saveFileItem = async (core: ItemCore, input: SaveFileInput): Promise<SaveOutcome> => {
  const { name } = input;
  if (input.file.size > ITEM_FILE_MAX_BYTES) {
    throw new ItemsError("too-large", { bytes: input.file.size, name });
  }
  const kind = fileKindOf(name);
  if (!takesBytes(name) || kind === null) {
    throw new ItemsError("not-a-file-name");
  }
  const wrapper = await core.freePath(
    input.folder ?? UNSORTED_FOLDER,
    itemNameFromTitle(withoutExtension(name)) ?? FALLBACK_STEM,
  );
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const original = await core.writeOriginal(wrapper, name, bytes);
  const saved = formatItemTime(core.now().getTime());
  // a file saved from a page names where it came from, and was read when it was saved
  const fields: ItemFileFields =
    input.url === undefined
      ? { id: core.newId(), kind, saved }
      : { fetched: saved, id: core.newId(), kind, saved, url: cleanUrl(input.url) ?? input.url };
  const content = composeItemFile(
    input.tags === undefined ? fields : { ...fields, tags: input.tags },
    `${embedMarkdown(original.path)}\n`,
  );
  let created: { path: string };
  try {
    created = await core.createDoc({
      content,
      folder: dirnamePath(wrapper),
      stem: docStem(wrapper),
    });
  } catch (error) {
    // the original alone would be a bare card nobody asked for
    try {
      await core.remove(original.path);
    } catch {
      // best effort: the create's own refusal is the one to report
    }
    throw error;
  }
  return {
    fill: { state: "filled" },
    outcome: "created",
    path: created.path,
    wrote: [original.path, created.path],
  };
};
