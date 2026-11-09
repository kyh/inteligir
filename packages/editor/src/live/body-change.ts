// An edit of a note's body by block id, applied through the editor so its binding carries it into
// the live document. Each change names its base, the block as the writer read it; a base that no
// longer holds lands nothing, so the writer reads again rather than overwrite what moved since.

import { ElementApi, TextApi } from "platejs";
import type { Descendant, Path, SlateEditor, TElement, TText } from "platejs";
import { YjsEditor } from "@slate-yjs/core";

import { sameJson } from "@repo/contract/library/canonical-json";
import type { JsonValue } from "@repo/contract/library/canonical-json";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { blockId } from "@repo/editor/node-props";
import { diffLines } from "@repo/editor/text/line-diff";

import { libraryJsonOf } from "../codec/read-blocks";
import { MARK_KEYS } from "../codec/slate-leaves";
import { blockOfElement, sectionOf, sectioned } from "./note-blocks";

// `afterId` null is the top of the note.
/** @internal */
export type BodyChange =
  | {
      readonly kind: "put";
      readonly blockId: string;
      readonly base: LibraryBlock;
      readonly block: LibraryBlock;
    }
  | {
      readonly kind: "insertAfter";
      readonly afterId: string | null;
      readonly block: LibraryBlock;
      readonly section: LibrarySection;
    }
  | { readonly kind: "drop"; readonly blockId: string; readonly base: LibraryBlock }
  | {
      readonly kind: "move";
      readonly blockId: string;
      readonly afterId: string | null;
      readonly base: LibraryBlock;
    };

// `moved`: the blocks whose base no longer holds, or that a change names and the note no longer
// holds once, and none of the changes landed
/** @internal */
export type BodyChangeOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "moved"; readonly blockIds: readonly string[] };

const indexOfBlock = (editor: SlateEditor, id: string): number =>
  editor.children.findIndex((node) => blockId(node) === id);

// Every base is the block as it stood before these changes, checked before any lands, so a batch
// lands whole or not at all. A base holds when the block reads the same as the library stores it,
// the ids inside it and its section aside: those are the document's, and a block renamed inside
// by another editor is the same block.
const movedBlocks = (editor: SlateEditor, changes: readonly BodyChange[]): string[] => {
  const before = new Map<string, TElement | null>();
  for (const node of editor.children) {
    const id = blockId(node);
    if (id !== undefined) {
      // an id the document holds twice names no one block
      before.set(id, before.has(id) ? null : node);
    }
  }
  const standing = new Set([...before].flatMap(([id, node]) => (node === null ? [] : [id])));
  const moved = new Set<string>();
  const placeAfter = (afterId: string | null): void => {
    if (afterId !== null && !standing.has(afterId)) {
      moved.add(afterId);
    }
  };
  const baseHolds = (id: string, base: LibraryBlock): boolean => {
    const element = before.get(id);
    const block = element === undefined || element === null ? null : blockOfElement(element);
    return standing.has(id) && block !== null && sameJson(block, base);
  };
  for (const change of changes) {
    switch (change.kind) {
      case "put":
      case "drop":
      case "move": {
        if (!baseHolds(change.blockId, change.base)) {
          moved.add(change.blockId);
        }
        if (change.kind === "drop") {
          standing.delete(change.blockId);
        }
        if (change.kind === "move" && change.afterId !== change.blockId) {
          placeAfter(change.afterId);
        }
        break;
      }
      case "insertAfter": {
        placeAfter(change.afterId);
        if (standing.has(change.block.id) || before.has(change.block.id)) {
          moved.add(change.block.id);
        }
        standing.add(change.block.id);
        break;
      }
      // no default
    }
  }
  return [...moved];
};

// children as the library spells them: Slate keeps an empty text beside each inline element,
// which a stored block drops, so those are passed over unless one is all an element holds
const spelled = (children: readonly Descendant[]): { node: Descendant; index: number }[] => {
  const all = children.map((node, index) => ({ index, node }));
  return all.length === 1
    ? all
    : all.filter(({ node }) => !TextApi.isText(node) || node.text !== "");
};

// the block keeps its type, and each element and text where it was
const fitsInPlace = (current: TElement, next: TElement): boolean => {
  const now = spelled(current.children);
  const then = spelled(next.children);
  return (
    current.type === next.type &&
    now.length === then.length &&
    now.every(({ node }, index) => {
      const other = then[index]?.node;
      if (other === undefined) {
        return false;
      }
      if (ElementApi.isElement(node) && ElementApi.isElement(other)) {
        return fitsInPlace(node, other);
      }
      return TextApi.isText(node) && TextApi.isText(other);
    })
  );
};

// an element's own props as the library spells them, its children aside
const ownProps = (element: TElement): Map<string, JsonValue> =>
  new Map(
    Object.entries(libraryJsonOf({ ...element, children: [] })).filter(
      ([key]) => key !== "children" && key !== "type",
    ),
  );

const setProps = (editor: SlateEditor, at: Path, current: TElement, next: TElement): void => {
  const now = ownProps(current);
  const then = ownProps(next);
  for (const [key, value] of then) {
    const held = now.get(key);
    if (held === undefined || !sameJson(held, value)) {
      editor.tf.setNodes({ [key]: value }, { at });
    }
  }
  for (const key of now.keys()) {
    if (!then.has(key)) {
      editor.tf.unsetNodes(key, { at });
    }
  }
};

// UTF-16 offset of each code point, and the end, so a diff over code points never splits a pair
const codeUnitOffsets = (points: readonly string[]): number[] => {
  const offsets = [0];
  for (const point of points) {
    offsets.push((offsets.at(-1) ?? 0) + point.length);
  }
  return offsets;
};

// The fewest code points removed and inserted, last hunk first so the earlier offsets still hold;
// text a person typed between the hunks is never touched.
const editText = (editor: SlateEditor, path: Path, current: TText, next: TText): void => {
  for (const key of MARK_KEYS) {
    if (next[key] === true && current[key] !== true) {
      editor.tf.setNodes({ [key]: true }, { at: path });
    }
    if (next[key] !== true && current[key] === true) {
      editor.tf.unsetNodes(key, { at: path });
    }
  }
  const was = [...current.text];
  const now = [...next.text];
  const offsets = codeUnitOffsets(was);
  const { hunks } = diffLines(was, now);
  for (const hunk of hunks.toReversed()) {
    const offset = offsets[hunk.baseStart] ?? 0;
    const removed = was.slice(hunk.baseStart, hunk.baseEnd).join("");
    if (removed !== "") {
      editor.tf.apply({ offset, path, text: removed, type: "remove_text" });
    }
    const inserted = now.slice(hunk.sideStart, hunk.sideEnd).join("");
    if (inserted !== "") {
      editor.tf.apply({ offset, path, text: inserted, type: "insert_text" });
    }
  }
};

const editInPlace = (editor: SlateEditor, path: Path, current: TElement, next: TElement): void => {
  setProps(editor, path, current, next);
  const then = spelled(next.children);
  for (const [at, { node, index }] of spelled(current.children).entries()) {
    const other = then[at]?.node;
    const childPath = [...path, index];
    if (ElementApi.isElement(node) && ElementApi.isElement(other)) {
      editInPlace(editor, childPath, node, other);
    } else if (TextApi.isText(node) && TextApi.isText(other)) {
      editText(editor, childPath, node, other);
    }
  }
};

const put = (editor: SlateEditor, block: LibraryBlock): void => {
  const index = indexOfBlock(editor, block.id);
  const current = editor.children[index];
  if (current === undefined) {
    return;
  }
  const next = sectioned(block, sectionOf(current));
  if (fitsInPlace(current, next)) {
    editInPlace(editor, [index], current, next);
    return;
  }
  editor.tf.removeNodes({ at: [index] });
  editor.tf.insertNodes(next, { at: [index] });
};

const afterIndex = (editor: SlateEditor, afterId: string | null): number =>
  afterId === null ? 0 : indexOfBlock(editor, afterId) + 1;

// a block moved after itself stays where it is
const move = (editor: SlateEditor, id: string, afterId: string | null): void => {
  if (afterId === id) {
    return;
  }
  const from = indexOfBlock(editor, id);
  const after = afterId === null ? -1 : indexOfBlock(editor, afterId);
  // a move's target counts the places once the block has left its own
  const to = after < from ? after + 1 : after;
  if (to !== from) {
    editor.tf.moveNodes({ at: [from], to: [to] });
  }
};

// A put that keeps the block's shape (its type, and each element and text where it was) edits it
// in place, text by the fewest characters and props one by one, so what a person types elsewhere
// in the block meanwhile stays; one that reshapes it replaces it whole under its id. What lands is
// in the document when this returns, rather than at the editor's next change.
/** @internal */
export const applyBodyChanges = (
  editor: SlateEditor & YjsEditor,
  changes: readonly BodyChange[],
): BodyChangeOutcome => {
  const blockIds = movedBlocks(editor, changes);
  if (blockIds.length > 0) {
    return { blockIds, kind: "moved" };
  }
  editor.tf.withoutNormalizing(() => {
    for (const change of changes) {
      switch (change.kind) {
        case "put": {
          put(editor, change.block);
          break;
        }
        case "insertAfter": {
          editor.tf.insertNodes(sectioned(change.block, change.section), {
            at: [afterIndex(editor, change.afterId)],
          });
          break;
        }
        case "drop": {
          editor.tf.removeNodes({ at: [indexOfBlock(editor, change.blockId)] });
          break;
        }
        case "move": {
          move(editor, change.blockId, change.afterId);
          break;
        }
        // no default
      }
    }
  });
  YjsEditor.flushLocalChanges(editor);
  return { kind: "applied" };
};
