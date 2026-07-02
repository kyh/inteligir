// Incremental markdown parsing for the generate flow (#370): streamed deltas
// accumulate as markdown TEXT, and each append re-parses the accumulated
// stream through the owned pipeline (markdown-doc's parseMarkdown) and
// reconciles the streamed block range in place — blocks whose parse didn't
// change are left untouched; only the trailing block(s) the stream is still
// refining get replaced. Headings, lists, bold, fences land as real blocks
// instead of literal text in one paragraph.
//
// Pattern adapted from @platejs/ai's streamInsertChunk (MIT, © Ziad Beyens /
// Udecode contributors — the utility Plate Plus' potion template drives).
// Reworked rather than imported: the package's ai-sdk peer range (ai@7)
// conflicts with ours (ai@6), and its per-chunk bookkeeping serializes the
// trailing block back to markdown to keep appending — a whole
// serialize/deserialize drift class we sidestep by re-parsing the full
// accumulated text (generations are short; the parse is our owned pipeline)
// and diffing parses structurally.
//
// Byte-safety: every inserted node — text AND element — is stamped with the
// transient AI_MARK, so markdown-editor's save gate
// (transient.ts::hasTransientAiState) freezes autosave for the whole stream
// and the serializer predicate (transient.ts::shouldSerializeNode) drops the
// streamed blocks wholesale if anything serializes mid-stream. Discard stays
// the caller's undo-unwind: every mutation here runs through editor.tf, one
// history batch per append.

import { ElementApi, KEYS, NodeApi, TextApi, type Descendant, type SlateEditor } from "platejs";

import { AI_MARK } from "@repo/app/editor/ai/ai-mark";
import { parseMarkdown } from "@repo/app/editor/markdown/markdown-doc";

/** Stamp the transient AI mark on every node (recursively), so the save gate
 * and the serializer predicate cover the entire streamed range. */
function stampAiMark(nodes: Descendant[]): Descendant[] {
  return nodes.map((node) =>
    TextApi.isText(node)
      ? { ...node, [AI_MARK]: true }
      : { ...node, [AI_MARK]: true, children: stampAiMark(node.children) },
  );
}

/** Parse the accumulated stream. Mid-stream text can be transiently
 * unparseable (a half-arrived tag) or out-of-vocabulary — degrade to plain
 * paragraphs so the stream stays visible; a later append re-parses the full
 * text and the reconcile heals the range. */
function parseStreamed(md: string): Descendant[] {
  if (md.trim().length === 0) return [];
  const parsed = parseMarkdown(md);
  if (parsed.ok && parsed.value.length > 0) return parsed.value;
  return md.split(/\n{2,}/).flatMap((part) => {
    const text = part.trim();
    return text.length === 0 ? [] : [{ children: [{ text }], type: KEYS.p }];
  });
}

/** Structural node equality (props + children, order-insensitive on keys) —
 * how the reconcile decides a streamed block is settled. */
function nodesEqual(a: Descendant, b: Descendant): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (key === "children") continue;
    if (!Object.is(a[key], b[key])) return false;
  }
  const aChildren = ElementApi.isElement(a) ? a.children : null;
  const bChildren = ElementApi.isElement(b) ? b.children : null;
  if (aChildren === null || bChildren === null) return aChildren === bChildren;
  if (aChildren.length !== bChildren.length) return false;
  return aChildren.every((child, i) => {
    const other = bChildren[i];
    return other !== undefined && nodesEqual(child, other);
  });
}

/** A plain empty paragraph the stream may replace (generating on a blank line
 * must not leave the blank line behind; discard's undo restores it). Empty
 * LIST items keep their bullet — only unadorned paragraphs qualify. */
function isReplaceableSeed(node: Descendant): boolean {
  return (
    ElementApi.isElement(node) &&
    node.type === KEYS.p &&
    !("listStyleType" in node) &&
    NodeApi.string(node).length === 0
  );
}

/**
 * Create a markdown stream inserting below the top-level block at
 * `caretBlock` (or in its place when it's an empty plain paragraph). Assumes
 * nothing else moves top-level blocks while the stream runs — the AI menu
 * owns the surface for the duration.
 */
export function createMarkdownStream(
  editor: SlateEditor,
  caretBlock: number,
): { append: (delta: string) => void; text: () => string } {
  let text = "";
  let anchor: number | null = null;
  let blocks: Descendant[] = [];

  const reconcile = (next: Descendant[]): void => {
    editor.tf.withoutNormalizing(() => {
      if (anchor === null) {
        const seed = editor.api.node([caretBlock]);
        const replaceSeed = seed !== undefined && isReplaceableSeed(seed[0]);
        anchor = replaceSeed ? caretBlock : caretBlock + 1;
        if (replaceSeed) editor.tf.removeNodes({ at: [caretBlock] });
        editor.tf.insertNodes(next, { at: [anchor] });
      } else {
        // Replace only from the first block whose parse changed — settled
        // blocks stay untouched (no flicker, minimal ops).
        let stable = 0;
        while (stable < blocks.length && stable < next.length) {
          const prev = blocks[stable];
          const parsed = next[stable];
          if (prev === undefined || parsed === undefined || !nodesEqual(prev, parsed)) break;
          stable += 1;
        }
        for (let i = blocks.length - 1; i >= stable; i--) {
          editor.tf.removeNodes({ at: [anchor + i] });
        }
        if (stable < next.length) {
          editor.tf.insertNodes(next.slice(stable), { at: [anchor + stable] });
        }
      }
      const end = editor.api.end([anchor + next.length - 1]);
      if (end) editor.tf.select(end);
    });
    blocks = next;
  };

  return {
    append: (delta: string): void => {
      if (delta.length === 0) return;
      text += delta;
      const next = stampAiMark(parseStreamed(text));
      if (next.length === 0) return; // nothing visible yet (leading whitespace)
      reconcile(next);
    },
    text: () => text,
  };
}

/** Strip every transient AI_MARK stamp — accept: the parsed blocks become
 * ordinary content and the byte-safety gate releases. */
export function stripAiMarks(editor: SlateEditor): void {
  editor.tf.unsetNodes([AI_MARK], { at: [], match: (n) => AI_MARK in n, mode: "all" });
}
