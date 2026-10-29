// CLAUDE.md § AN ITEM'S INFO IS READ FROM THE INDEX AND WRITTEN AS A FRONTMATTER LINE EDIT. One
// edit behind Info, the card menu and the palette, down the pin's two paths: the open item takes
// it through the live editor's frontmatter node, so the buffer and the autosave carry it; any
// other item goes through the guarded rewrite, and an item that moved underneath is refused,
// never merged, since an edit is one click to repeat. Tags across many items ride `items.tag`,
// the server's line edit, in chunks it takes at once.

import { getLiveEditor } from "@repo/editor/live-editor";
import { readFrontmatterRaw, writeFrontmatterRaw } from "@repo/editor/properties/properties-node";
import { withItemFields } from "@repo/notes/items/item-frontmatter";
import type { ItemFieldPatch } from "@repo/notes/items/item-frontmatter";
import { addFrontmatterTags, removeFrontmatterTags } from "@repo/notes/items/item-tags";
import { frontmatterYaml } from "@repo/notes/markdown/frontmatter";
import { ITEMS_TAG_PATHS_MAX } from "@repo/contract/local/items/items-schema";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";

import { client } from "../api";
import { runBulk } from "../library/bulk-actions";
import { rewriteNote } from "./rewrite-note";
import type { RewriteNoteApi } from "./rewrite-note";

export type FrontmatterEditVerdict =
  | { kind: "written"; content: string }
  | { kind: "unchanged" }
  | { kind: "invalid" }
  | { kind: "refused"; reason: string };

export type FrontmatterEditOutcome =
  | { kind: "done" }
  | { kind: "unchanged" }
  | { kind: "refused"; message: string };

// the live editor holds the block alone, so an edit written for a whole file runs over the block
// as a file of its own, and the block it answers goes back into the node
const blockAsFile = (raw: string | null): string => (raw === null ? "" : `---\n${raw}\n---\n`);

// `verb` names the edit in a refusal: "Could not pin Plans.md: …"
export const editFrontmatter = async (
  api: RewriteNoteApi,
  path: string,
  verb: string,
  edit: (content: string) => FrontmatterEditVerdict,
): Promise<FrontmatterEditOutcome> => {
  const unreadable = `Could not ${verb} ${path}: its frontmatter is not valid YAML.`;
  const refusedFor = (reason: string) => `Could not ${verb} ${path}: ${reason}.`;
  const editor = getLiveEditor(path);
  if (editor !== null) {
    const verdict = edit(blockAsFile(readFrontmatterRaw(editor)));
    switch (verdict.kind) {
      case "written": {
        writeFrontmatterRaw(editor, frontmatterYaml(verdict.content) ?? "");
        return { kind: "done" };
      }
      case "unchanged": {
        return { kind: "unchanged" };
      }
      case "invalid": {
        return { kind: "refused", message: unreadable };
      }
      case "refused": {
        return { kind: "refused", message: refusedFor(verdict.reason) };
      }
      default: {
        const exhaustive: never = verdict;
        return exhaustive;
      }
    }
  }
  // a refusal answers the same bytes with the verdict beside them, so nothing is written
  const outcome = await rewriteNote<FrontmatterEditVerdict>(api, path, (content) => {
    const verdict = edit(content);
    return verdict.kind === "written"
      ? { content: verdict.content, result: verdict }
      : { content, result: verdict };
  });
  switch (outcome.kind) {
    case "written": {
      return { kind: "done" };
    }
    case "unchanged": {
      const { result } = outcome;
      if (result.kind === "invalid") {
        return { kind: "refused", message: unreadable };
      }
      if (result.kind === "refused") {
        return { kind: "refused", message: refusedFor(result.reason) };
      }
      return { kind: "unchanged" };
    }
    case "changed": {
      return {
        kind: "refused",
        message: `Could not ${verb} ${path}: it changed since it was read.`,
      };
    }
    case "failed": {
      return { kind: "refused", message: `Could not ${verb} ${path}: ${outcome.message}` };
    }
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
};

// Info's fields: the item's own keys, written where `@repo/notes` puts them
export const editItemFields = async (
  api: RewriteNoteApi,
  path: string,
  patch: ItemFieldPatch,
): Promise<FrontmatterEditOutcome> =>
  await editFrontmatter(api, path, "change", (content) => {
    const verdict = withItemFields(content, patch);
    return verdict.kind === "refused" ? { kind: "refused", reason: verdict.reason } : verdict;
  });

// the open item's tags, through the live editor; `inline` names removed tags written as #tag
const retagLive = (
  path: string,
  change: { add: readonly string[]; remove: readonly string[] },
): { outcome: FrontmatterEditOutcome; inline: string[] } | null => {
  const editor = getLiveEditor(path);
  if (editor === null) {
    return null;
  }
  let content = blockAsFile(readFrontmatterRaw(editor));
  if (change.add.length > 0) {
    const added = addFrontmatterTags(content, change.add);
    if (added === null) {
      return {
        inline: [],
        outcome: {
          kind: "refused",
          message: `Could not tag ${path}: its frontmatter is not valid YAML.`,
        },
      };
    }
    content = added;
  }
  let inline: string[] = [];
  if (change.remove.length > 0) {
    const removed = removeFrontmatterTags(content, change.remove);
    ({ inline } = removed);
    if (removed.content === null) {
      return {
        inline,
        outcome: {
          kind: "refused",
          message: `Could not tag ${path}: its frontmatter is not valid YAML.`,
        },
      };
    }
    ({ content } = removed);
  }
  const yaml = frontmatterYaml(content) ?? "";
  if (yaml === (readFrontmatterRaw(editor) ?? "")) {
    return { inline, outcome: { kind: "unchanged" } };
  }
  writeFrontmatterRaw(editor, yaml);
  return { inline, outcome: { kind: "done" } };
};

const sayInline = (inline: ReadonlySet<string>): void => {
  for (const tag of inline) {
    toast.info(`#${tag} is written in the text`);
  }
};

// Tag… over any number of items: the open one through its editor, the rest by `items.tag` in
// chunks of ITEMS_TAG_PATHS_MAX under one progress toast
export const retagItems = async (
  paths: readonly string[],
  change: { add: readonly string[]; remove: readonly string[] },
): Promise<void> => {
  const inline = new Set<string>();
  const rest: string[] = [];
  for (const path of paths) {
    const live = retagLive(path, change);
    if (live === null) {
      rest.push(path);
      continue;
    }
    for (const tag of live.inline) {
      inline.add(tag);
    }
    if (live.outcome.kind === "refused") {
      toast.error(live.outcome.message);
    }
  }
  let conflicts = 0;
  if (rest.length > 0) {
    await runBulk({
      chunk: ITEMS_TAG_PATHS_MAX,
      done: (count) => `Tagged ${plural(count, "item")}`,
      items: rest,
      run: async (chunk) => {
        const { results } = await client.items.tag({
          add: [...change.add],
          paths: [...chunk],
          remove: [...change.remove],
        });
        let tagged = 0;
        for (const result of results) {
          for (const tag of result.inline) {
            inline.add(tag);
          }
          if (result.outcome === "conflict" || result.outcome === "invalid") {
            conflicts += 1;
          } else if (result.outcome !== "missing") {
            tagged += 1;
          }
        }
        return tagged;
      },
      verb: "Tagging",
    });
  }
  if (conflicts > 0) {
    toast.warning(`${plural(conflicts, "item")} could not be tagged: changed or unreadable.`);
  }
  sayInline(inline);
};
