// a stub whose url another item already holds, filled: the stub is not fetched, its tags and its
// note go to that item (the note right after the item's first block, its cover), and the stub is
// removed. A stub with highlights of its own is filled as itself, so no highlight loses its text.

import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import { bodyOf, withBody } from "@repo/notes/items/item-body";
import { addFrontmatterTags } from "@repo/notes/items/item-tags";
import { KNOWLEDGE_FIND_BY_URL_MAX } from "@repo/contract/local/knowledge/knowledge-schema";

import type { KnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import type { ItemCore } from "../item-core";

const CAS_TRIES = 3;

// the body with a block inserted after its first one
const insertAfterFirstBlock = (content: string, block: string): string => {
  const trimmed = block.trim();
  if (trimmed === "") {
    return content;
  }
  const body = bodyOf(content);
  const split = /\r?\n[ \t]*\r?\n/u.exec(body);
  if (split === null) {
    return withBody(
      content,
      body.trim() === "" ? `${trimmed}\n` : `${body.trimEnd()}\n\n${trimmed}\n`,
    );
  }
  const head = body.slice(0, split.index);
  const rest = body.slice(split.index + split[0].length);
  return withBody(content, `${head}\n\n${trimmed}\n\n${rest.trimEnd()}\n`);
};

export interface Folded {
  into: string;
  wrote: string[];
}

export const foldDuplicate = async (
  deps: {
    core: Pick<ItemCore, "read" | "write" | "remove">;
    knowledge: Pick<KnowledgeRuntime, "findByUrl" | "itemsAt">;
  },
  stub: { itemId: string | null; path: string; url: string },
): Promise<Folded | null> => {
  if (stub.itemId === null || (await deps.core.read(annotationsStorePath(stub.itemId))) !== null) {
    return null;
  }
  const matches = await deps.knowledge.findByUrl(stub.url, KNOWLEDGE_FIND_BY_URL_MAX);
  const holder = matches.items.find((item) => item.path !== stub.path && !item.pending);
  const stubRead = await deps.core.read(stub.path);
  if (holder === undefined || stubRead === null) {
    return null;
  }
  const [stubRow] = await deps.knowledge.itemsAt([stub.path]);
  const tags = stubRow?.tags ?? [];
  const note = bodyOf(stubRead.content);
  for (let attempt = 0; attempt < CAS_TRIES; attempt += 1) {
    const read = await deps.core.read(holder.path);
    const tagged = read === null ? null : addFrontmatterTags(read.content, tags);
    if (read === null || tagged === null) {
      return null;
    }
    const next = insertAfterFirstBlock(tagged, note);
    if (
      next === read.content ||
      (await deps.core.write(holder.path, next, read.hash)) === "written"
    ) {
      await deps.core.remove(stub.path);
      return {
        into: holder.path,
        wrote: next === read.content ? [stub.path] : [holder.path, stub.path],
      };
    }
  }
  return null;
};
