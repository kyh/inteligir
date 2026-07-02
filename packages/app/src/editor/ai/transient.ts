// Transient-AI byte-safety — the two gates that keep in-flight AI state out
// of the file:
//
// 1. `shouldSerializeNode` (markdown-kit's allowNode.serialize): if transient
//    nodes ever reach the serializer, the output is REJECT-EQUIVALENT —
//    AI-streamed nodes (stream-markdown stamps AI_MARK on the whole inserted
//    block, element AND texts) and pending INSERT suggestions (proposed
//    content) are dropped; remove/update suggestions keep their text (it's
//    the user's original; the suggestion props have no markdown form and
//    serialize to nothing).
// 2. `hasTransientAiState` (markdown-editor's onChange gate): while an AI
//    stream or a suggestion session is touching the document, serialization
//    is skipped entirely — the save buffer freezes at the pre-session bytes
//    and catches up when the session resolves (accept/reject/discard).
//
// Layered deliberately: the gate is the primary mechanism (it also covers
// mark-only `update` suggestions, which a node-level predicate can't revert);
// the serializer predicate is defense in depth.

import { ElementApi, KEYS, type Descendant, type SlateEditor } from "platejs";

import { AI_MARK } from "@repo/app/editor/ai/ai-mark";

const SUGGESTION_KEY_PREFIX = `${KEYS.suggestion}_`;

type SuggestionDataLite = {
  type: "insert" | "remove" | "update";
  isLineBreak: boolean;
};

function readSuggestionData(value: unknown): SuggestionDataLite | null {
  if (typeof value !== "object" || value === null || !("type" in value)) return null;
  const { type } = value;
  if (type !== "insert" && type !== "remove" && type !== "update") return null;
  const isLineBreak = "isLineBreak" in value && value.isLineBreak === true;
  return { type, isLineBreak };
}

/** Every suggestion data record on a node: text/inline nodes carry them under
 * `suggestion_<id>` keys, block elements under a `suggestion` object. */
function suggestionDataList(node: Descendant): SuggestionDataLite[] {
  const list: SuggestionDataLite[] = [];
  for (const key of Object.keys(node)) {
    if (key !== KEYS.suggestion && !key.startsWith(SUGGESTION_KEY_PREFIX)) continue;
    const data = readSuggestionData(node[key]);
    if (data) list.push(data);
  }
  return list;
}

/**
 * allowNode.serialize predicate for the shared markdown kit. Excludes nodes
 * whose CONTENT is a pending AI proposal:
 * - AI-streamed nodes (the generate flow stamps AI_MARK on every inserted
 *   node — dropping the marked TEXTS alone would leave empty husk blocks, so
 *   the marked ELEMENTS are excluded here too; disallowedNodes already drops
 *   the texts),
 * - insert-type suggestion texts/inline elements (proposed text),
 * - insert-type block suggestions (proposed blocks) — except line-break
 *   inserts, whose children are original text that a proposed split merely
 *   re-arranged (dropping the element would lose user content).
 * Remove/update suggestions serialize: their text is the user's original and
 * the suggestion props themselves have no markdown form.
 */
export function shouldSerializeNode(node: Descendant): boolean {
  if (node[AI_MARK] === true) return false;
  return !suggestionDataList(node).some((data) => data.type === "insert" && !data.isLineBreak);
}

/** Plate's transient-suggestion marker (`@platejs/suggestion`'s
 * getTransientSuggestionKey) — inlined as a constant so non-react modules
 * don't need the package at runtime. Pinned by test against the real key. */
export const TRANSIENT_SUGGESTION_KEY = `${KEYS.suggestion}Transient`;

function isTransientSuggestionNode(node: Descendant): boolean {
  return node[TRANSIENT_SUGGESTION_KEY] === true;
}

/**
 * True while the document holds in-flight AI state: an ai-marked streaming
 * range (texts AND the stamped block elements — see stream-markdown) or an
 * unresolved (transient) suggestion. markdown-editor skips serialization
 * while this holds, freezing the save buffer at the pre-session bytes.
 */
export function hasTransientAiState(editor: SlateEditor): boolean {
  const walk = (nodes: Descendant[]): boolean =>
    nodes.some((node) => {
      if (node[AI_MARK] === true || isTransientSuggestionNode(node)) return true;
      return ElementApi.isElement(node) && walk(node.children);
    });
  return walk(editor.children);
}
