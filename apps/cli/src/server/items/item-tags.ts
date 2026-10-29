// `items.tag`: one frontmatter line edit per item, under that item's own compare-and-swap, so a tag
// added to a hundred items rewrites nothing else in any of them and an edit landing meanwhile is
// retried against, never overwritten.

import type { ItemTagResult, itemsTagRequestSchema } from "@repo/contract/local/items/items-schema";
import { addFrontmatterTags, removeFrontmatterTags } from "@repo/notes/items/item-tags";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { z } from "zod";

import { VaultServiceError } from "../vault/vault-service";
import type { ItemCore } from "./item-core";

export type TagItemsInput = z.output<typeof itemsTagRequestSchema>;

const CAS_TRIES = 3;

// the edit both lists ask, or null when the block cannot take it
const retagged = (
  content: string,
  add: readonly string[],
  remove: readonly string[],
): { content: string; inline: string[] } | null => {
  const added = add.length === 0 ? content : addFrontmatterTags(content, add);
  if (added === null) {
    return null;
  }
  if (remove.length === 0) {
    return { content: added, inline: [] };
  }
  const removal = removeFrontmatterTags(added, remove);
  return removal.content === null ? null : { content: removal.content, inline: removal.inline };
};

const readOrTooLarge = async (
  core: ItemCore,
  path: string,
): Promise<{ content: string; hash: string } | null | "too-large"> => {
  try {
    return await core.read(path);
  } catch (error) {
    if (error instanceof VaultServiceError && error.code === "too_large") {
      return "too-large";
    }
    throw error;
  }
};

const tagOne = async (
  core: ItemCore,
  path: string,
  input: TagItemsInput,
): Promise<ItemTagResult> => {
  // a file that is not a doc holds no frontmatter to write a tag into
  if (!isDocPath(path)) {
    return { inline: [], outcome: "invalid", path };
  }
  for (let attempt = 0; attempt < CAS_TRIES; attempt += 1) {
    const current = await readOrTooLarge(core, path);
    if (current === null) {
      return { inline: [], outcome: "missing", path };
    }
    if (current === "too-large") {
      return { inline: [], outcome: "invalid", path };
    }
    const next = retagged(current.content, input.add, input.remove);
    if (next === null) {
      return { inline: [], outcome: "invalid", path };
    }
    if (next.content === current.content) {
      return { inline: next.inline, outcome: "unchanged", path };
    }
    const written = await core.write(path, next.content, current.hash);
    if (written === "written") {
      return { inline: next.inline, outcome: "changed", path };
    }
    if (written === "gone") {
      return { inline: [], outcome: "missing", path };
    }
  }
  return { inline: [], outcome: "conflict", path };
};

// in request order, one at a time: each is a read and at most a few writes
export const tagItems = async (
  core: ItemCore,
  input: TagItemsInput,
): Promise<{ results: ItemTagResult[]; wrote: string[] }> => {
  const results: ItemTagResult[] = [];
  for (const path of input.paths) {
    results.push(await tagOne(core, path, input));
  }
  return {
    results,
    wrote: results.flatMap((result) => (result.outcome === "changed" ? [result.path] : [])),
  };
};
