import { ElementApi, KEYS } from "platejs";
import type { Descendant, Path, SlateEditor, TElement, TText } from "platejs";

import { sameJson } from "@repo/contract/library/canonical-json";
import type { JsonValue } from "@repo/contract/library/canonical-json";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { PICKER_INPUT_TYPES } from "@repo/editor/headless/combobox-input";
import { blockId } from "@repo/editor/headless/node-props";
import { diffLines } from "@repo/editor/headless/text/line-diff";

import { libraryJsonOf } from "@repo/editor/headless/codec/read-blocks";
import { MARK_KEYS, sameMarks } from "@repo/editor/headless/codec/slate-leaves";
import { blockOfElement } from "./element-block";
import { sectionOf, sectioned, setSection } from "./note-section";

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

type BodyChangeOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "moved"; readonly blockIds: readonly string[] };

const indexOfBlock = (editor: SlateEditor, id: string) =>
  editor.children.findIndex((node) => blockId(node) === id);

const movedBlocks = (editor: SlateEditor, changes: readonly BodyChange[]) => {
  const before = new Map<string, TElement | null>();

  for (const node of editor.children) {
    const id = blockId(node);

    if (id !== undefined) {
      before.set(id, before.has(id) ? null : node);
    }
  }

  const standing = new Set([...before].flatMap(([id, node]) => (node === null ? [] : [id])));
  const moved = new Set<string>();

  const placeAfter = (afterId: string | null) => {
    if (afterId !== null && !standing.has(afterId)) {
      moved.add(afterId);
    }
  };

  const baseHolds = (id: string, base: LibraryBlock) => {
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

      default: {
        throw new Error(`unexpected ${String(change satisfies never)}`);
      }
    }
  }

  return [...moved] satisfies string[];
};

interface TextRun {
  readonly kind: "text";
  readonly parts: readonly { readonly index: number; readonly node: TText }[];
}

type Spelled =
  | TextRun
  | { readonly kind: "element"; readonly index: number; readonly node: TElement };

const runText = (run: TextRun) => run.parts.map(({ node }) => node.text).join("");

const spelled = (children: readonly Descendant[]) => {
  const all: Spelled[] = [];

  for (const [index, node] of children.entries()) {
    if (ElementApi.isElement(node)) {
      if (!PICKER_INPUT_TYPES.includes(node.type)) {
        all.push({ index, kind: "element", node });
      }

      continue;
    }

    const last = all.at(-1);
    const head = last?.kind === "text" ? last.parts[0] : undefined;

    if (last?.kind === "text" && head !== undefined && sameMarks(head.node, node)) {
      all[all.length - 1] = { kind: "text", parts: [...last.parts, { index, node }] };
      continue;
    }

    all.push({ kind: "text", parts: [{ index, node }] });
  }

  const shown = all.filter((one) => one.kind === "element" || runText(one) !== "");

  return shown.length > 0 ? shown : all.slice(0, 1);
};

const TEXT_TYPES: ReadonlySet<string> = new Set([KEYS.p, ...KEYS.heading, KEYS.blockquote]);

const fitsInPlace: (current: TElement, next: TElement, retypes: boolean) => boolean = (
  current: TElement,
  next: TElement,
  retypes: boolean,
) => {
  const now = spelled(current.children);
  const then = spelled(next.children);

  return (
    (current.type === next.type ||
      (retypes && TEXT_TYPES.has(current.type) && TEXT_TYPES.has(next.type))) &&
    now.length === then.length &&
    now.every((one, at) => {
      const other = then[at];

      if (one.kind === "element" && other?.kind === "element") {
        return fitsInPlace(one.node, other.node, false);
      }

      return one.kind === "text" && other?.kind === "text";
    })
  );
};

const ownProps = (element: TElement) =>
  new Map(
    Object.entries(libraryJsonOf({ ...element, children: [] })).filter(
      ([key]) => key !== "children" && key !== "type",
    ),
  ) satisfies Map<string, JsonValue>;

const setProps = (editor: SlateEditor, at: Path, current: TElement, next: TElement) => {
  if (current.type !== next.type) {
    editor.tf.setNodes({ type: next.type }, { at });
  }

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

const setMarks = (editor: SlateEditor, at: Path, current: TText, next: TText) => {
  for (const key of MARK_KEYS) {
    if (next[key] === true && current[key] !== true) {
      editor.tf.setNodes({ [key]: true }, { at });
    }

    if (next[key] !== true && current[key] === true) {
      editor.tf.unsetNodes(key, { at });
    }
  }
};

const codeUnitOffsets = (points: readonly string[]) => {
  const offsets = [0];

  for (const point of points) {
    offsets.push((offsets.at(-1) ?? 0) + point.length);
  }

  return offsets;
};

const editRun = (editor: SlateEditor, parent: Path, current: TextRun, next: TextRun) => {
  const target = next.parts[0]?.node;

  if (target === undefined) {
    return;
  }

  const parts = current.parts.map(({ index, node }, at) => {
    const start = current.parts.slice(0, at).reduce((sum, part) => sum + part.node.text.length, 0);

    return { end: start + node.text.length, node, path: [...parent, index], start };
  });

  for (const { node, path } of parts) {
    setMarks(editor, path, node, target);
  }

  const was = [...runText(current)];
  const now = [...target.text];
  const offsets = codeUnitOffsets(was);
  const { hunks } = diffLines(was, now);

  for (const hunk of hunks.toReversed()) {
    const from = offsets[hunk.baseStart] ?? 0;
    const to = offsets[hunk.baseEnd] ?? from;

    for (const { end, node, path, start } of parts) {
      const cutFrom = Math.max(from, start);
      const cutTo = Math.min(to, end);

      if (cutFrom < cutTo) {
        const text = node.text.slice(cutFrom - start, cutTo - start);
        editor.tf.apply({ offset: cutFrom - start, path, text, type: "remove_text" });
      }
    }

    const inserted = now.slice(hunk.sideStart, hunk.sideEnd).join("");
    const into = parts.find(({ end, start }) => start <= from && from <= end);

    if (inserted !== "" && into !== undefined) {
      editor.tf.apply({
        offset: from - into.start,
        path: into.path,
        text: inserted,
        type: "insert_text",
      });
    }
  }
};

const editInPlace = (editor: SlateEditor, path: Path, current: TElement, next: TElement) => {
  setProps(editor, path, current, next);
  const then = spelled(next.children);

  for (const [at, one] of spelled(current.children).entries()) {
    const other = then[at];

    if (one.kind === "element" && other?.kind === "element") {
      editInPlace(editor, [...path, one.index], one.node, other.node);
    } else if (one.kind === "text" && other?.kind === "text") {
      editRun(editor, path, one, other);
    }
  }
};

const place = (
  editor: SlateEditor,
  block: LibraryBlock,
  section: LibrarySection,
  index: number,
) => {
  const element: TElement = { ...block };
  editor.tf.insertNodes(element, { at: [index] });
  setSection(editor, [index], section);
};

const put = (editor: SlateEditor, block: LibraryBlock) => {
  const index = indexOfBlock(editor, block.id);
  const current = editor.children[index];

  if (current === undefined) {
    return;
  }

  const section = sectionOf(current);
  const next = sectioned(block, section);

  if (fitsInPlace(current, next, true)) {
    editInPlace(editor, [index], current, next);

    return;
  }

  editor.tf.removeNodes({ at: [index] });
  place(editor, block, section, index);
};

const afterIndex = (editor: SlateEditor, afterId: string | null) =>
  afterId === null ? 0 : indexOfBlock(editor, afterId) + 1;

const move = (editor: SlateEditor, id: string, afterId: string | null) => {
  if (afterId === id) {
    return;
  }

  const from = indexOfBlock(editor, id);
  const after = afterId === null ? -1 : indexOfBlock(editor, afterId);
  const to = after < from ? after + 1 : after;

  if (to !== from) {
    editor.tf.moveNodes({ at: [from], to: [to] });
  }
};

export const applyBodyChanges = (editor: SlateEditor, changes: readonly BodyChange[]) => {
  const blockIds = movedBlocks(editor, changes);

  if (blockIds.length > 0) {
    return { blockIds, kind: "moved" } satisfies BodyChangeOutcome;
  }

  editor.tf.withoutNormalizing(() => {
    for (const change of changes) {
      switch (change.kind) {
        case "put": {
          put(editor, change.block);
          break;
        }

        case "insertAfter": {
          place(editor, change.block, change.section, afterIndex(editor, change.afterId));
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

        default: {
          throw new Error(`unexpected ${String(change satisfies never)}`);
        }
      }
    }
  });

  return { kind: "applied" } satisfies BodyChangeOutcome;
};
