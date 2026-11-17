// The new note holds the very blocks that leave, as the item stores them, under the title their
// first heading or first line gives; their removal and the link that replaces them land in one
// change, an undo step of its own. The note is not undone with them: the host's create and this
// note's edit are two writes, and a note that exists is truer than an edit that never happened.
// So the item is touched only once the note is made and the blocks are still the ones it holds.

import { KEYS, NodeApi, PathApi } from "platejs";
import type { Path, SlateEditor, TElement } from "platejs";

import { shownTitle } from "@repo/contract/items/item-name";
import { sameJson } from "@repo/contract/library/canonical-json";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { toast } from "@repo/ui/components/sonner";

import { settledAlone } from "@repo/editor/headless/formulas/pill-nodes";
import { getEditorHostActions } from "@repo/editor/host-io";
import { blockOfElement } from "@repo/editor/headless/body/element-block";
import { ownUndoStep } from "@repo/editor/item/yjs-binding";
import { getLiveEditor } from "@repo/editor/live-editor";
import { OpenItemPlugin } from "@repo/editor/open-item";

const HEADING_TYPES = new Set<string>([KEYS.h1, KEYS.h2, KEYS.h3, KEYS.h4, KEYS.h5, KEYS.h6]);
const TITLE_MAX_CHARS = 80;

// the first heading among the blocks, else the first line of the first one
export const extractionTitle = (blocks: readonly TElement[]): string => {
  const source = blocks.find((block) => HEADING_TYPES.has(block.type)) ?? blocks[0];
  const line = source === undefined ? "" : (NodeApi.string(source).split("\n")[0] ?? "");
  return line.slice(0, TITLE_MAX_CHARS).trim();
};

// the top-level blocks the selection touches: a partly selected list leaves as a whole
export const selectedTopLevelPaths = (editor: SlateEditor): Path[] => {
  const at = editor.selection;
  if (!at) {
    return [];
  }
  return editor.api.blocks({ at, mode: "highest" }).map(([, path]) => path);
};

const blocksAt = (editor: SlateEditor, paths: readonly Path[]): TElement[] =>
  paths.flatMap((path) => {
    const entry = editor.api.node<TElement>(path);
    return entry === undefined ? [] : [entry[0]];
  });

// each element as the block the new note stores, a pill showing what it does once they stand
// apart from the pills they leave behind; null when one of them stores none
const storedBlocks = (elements: readonly TElement[]): LibraryBlock[] | null => {
  const blocks: LibraryBlock[] = [];
  for (const element of settledAlone(elements)) {
    const block = blockOfElement(element);
    if (block === null) {
      return null;
    }
    blocks.push(block);
  }
  return blocks;
};

// the page link Plate's mention insert writes: the note by its id, under the title it was made with
const linkParagraph = (editor: SlateEditor, itemId: string, title: string): TElement => ({
  children: [
    { text: "" },
    { children: [{ text: "" }], key: itemId, type: editor.getType(KEYS.mention), value: title },
    { text: "" },
  ],
  type: editor.getType(KEYS.p),
});

// the id of the note the blocks moved to, or null when they stayed where they were
export const extractBlocksToNote = async (
  editor: SlateEditor,
  paths: readonly Path[],
): Promise<string | null> => {
  const sorted = [...paths].toSorted(PathApi.compare);
  const elements = blocksAt(editor, sorted);
  const itemId = editor.getOption(OpenItemPlugin, "itemId");
  // only the editor answering for its item moves its blocks: a held item's draws what it cannot edit
  const answers = (): boolean => itemId !== null && getLiveEditor(itemId) === editor;
  if (elements.length === 0 || !answers()) {
    return null;
  }
  const blocks = storedBlocks(elements);
  if (blocks === null) {
    toast.error("Part of the selection can't be saved yet, so nothing was extracted.");
    return null;
  }
  const title = extractionTitle(elements);
  // typing, a change from elsewhere or leaving the item can move the blocks while the note is made
  const refs = sorted.map((path) => editor.api.pathRef(path));
  let created: string;
  try {
    created = await getEditorHostActions().items.createNote({ blocks, title });
  } catch {
    for (const ref of refs) {
      ref.unref();
    }
    toast.error("Couldn't make the new note, so nothing was extracted.");
    return null;
  }
  const current = refs
    .flatMap((ref) => {
      const path = ref.unref();
      return path === null ? [] : [path];
    })
    .toSorted(PathApi.compare);
  const [at] = current;
  const now = storedBlocks(blocksAt(editor, current));
  const unchanged =
    at !== undefined &&
    current.length === refs.length &&
    answers() &&
    now !== null &&
    sameJson(now, blocks);
  if (!unchanged) {
    toast.warning(
      `Made ${shownTitle(title)}, but this item changed meanwhile, so the blocks stayed.`,
    );
    return null;
  }
  ownUndoStep(editor, () => {
    editor.tf.withoutNormalizing(() => {
      for (const path of current.toReversed()) {
        editor.tf.removeNodes({ at: path });
      }
      editor.tf.insertNodes(linkParagraph(editor, created, title), { at });
    });
  });
  const end = editor.api.end(at);
  if (end !== undefined) {
    editor.tf.select(end);
  }
  editor.tf.focus();
  toast.success(`Extracted to ${shownTitle(title)}`);
  return created;
};
