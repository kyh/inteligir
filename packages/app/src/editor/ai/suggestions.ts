// AI suggestion sessions — an edit-intent AI response lands as track-changes
// marks the user resolves per change (or all at once). Built on
// @platejs/suggestion's diff/accept/reject machinery; the apply/resolve
// orchestration is adapted from @platejs/ai's applyAISuggestions /
// acceptAISuggestions / rejectAISuggestions (MIT, © Ziad Beyens et al).
//
// Every node a session touches carries the TRANSIENT suggestion key, so the
// marks are UI state, never content: markdown-kit's allowNode predicate keeps
// pending insertions out of any serialization, and markdown-editor's onChange
// gate freezes the save buffer until the session resolves (see transient.ts).

import {
  BaseSuggestionPlugin,
  acceptSuggestion,
  diffToSuggestions,
  getSuggestionKey,
  getTransientSuggestionKey,
  rejectSuggestion,
} from "@platejs/suggestion";
import {
  ElementApi,
  KEYS,
  TextApi,
  type Descendant,
  type Path,
  type SlateEditor,
  type TInlineSuggestionData,
  type TSuggestionData,
} from "platejs";

export type ResolveMode = "accept" | "reject";

// Block elements carry TSuggestionData (insert/remove); text and inline
// elements carry TInlineSuggestionData (insert/remove/update).
type AnySuggestionData = TInlineSuggestionData | TSuggestionData;

/** Every unresolved (transient) suggestion id, in document order. */
export function transientSuggestionIds(editor: SlateEditor): string[] {
  const api = editor.getApi(BaseSuggestionPlugin).suggestion;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const [node] of api.nodes({ transient: true })) {
    for (const data of dataListOf(node)) {
      if (seen.has(data.id)) continue;
      seen.add(data.id);
      ids.push(data.id);
    }
  }
  return ids;
}

/** True while any suggestion session is unresolved. */
export function hasTransientSuggestions(editor: SlateEditor): boolean {
  const api = editor.getApi(BaseSuggestionPlugin).suggestion;
  return api.nodes({ transient: true }).length > 0;
}

function isSuggestionData(value: unknown): value is AnySuggestionData {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || typeof value.id !== "string") return false;
  if (!("userId" in value) || !("createdAt" in value)) return false;
  return (
    "type" in value &&
    (value.type === "insert" || value.type === "remove" || value.type === "update")
  );
}

// Text/inline nodes carry data under suggestion_<id> keys (possibly several);
// block elements carry one record on `suggestion`. Structural read — the
// boolean `suggestion: true` text marker fails the data-shape guard.
function dataListOf(node: Descendant): AnySuggestionData[] {
  const list: AnySuggestionData[] = [];
  for (const key of Object.keys(node)) {
    if (key !== KEYS.suggestion && !key.startsWith(`${KEYS.suggestion}_`)) continue;
    const value = node[key];
    if (isSuggestionData(value)) list.push(value);
  }
  return list;
}

/**
 * Diff the blocks at `paths` (contiguous top-level paths, ascending) against
 * `replacement` and swap them for the suggestion-marked result, as a single
 * history batch (one undo reverts the whole application). Returns false —
 * leaving the document untouched — when the diff contains no changes.
 */
export function applyEditSuggestions(
  editor: SlateEditor,
  paths: Path[],
  replacement: Descendant[],
): boolean {
  const first = paths[0];
  if (first === undefined) return false;
  const originals: Descendant[] = [];
  for (const path of paths) {
    const entry = editor.api.node(path);
    if (!entry) return false;
    originals.push(entry[0]);
  }
  const diff: Descendant[] = diffToSuggestions(editor, originals, replacement, {
    ignoreProps: ["id"],
  });
  if (!containsSuggestion(diff)) return false;
  const transient = withTransient(diff);
  editor.tf.withoutNormalizing(() => {
    for (let i = paths.length - 1; i >= 0; i--) {
      const path = paths[i];
      if (path) editor.tf.removeNodes({ at: path });
    }
    editor.tf.insertNodes(transient, { at: first });
    editor.tf.select(editor.api.start(first) ?? []);
  });
  return true;
}

function containsSuggestion(nodes: Descendant[]): boolean {
  return nodes.some((node) => {
    if ("suggestion" in node && Boolean(node["suggestion"])) return true;
    return ElementApi.isElement(node) && containsSuggestion(node.children);
  });
}

function withTransient(nodes: Descendant[]): Descendant[] {
  const key = getTransientSuggestionKey();
  return nodes.map((node) => {
    if (TextApi.isText(node)) return { ...node, [key]: true };
    return { ...node, [key]: true, children: withTransient(node.children) };
  });
}

/** Strip every leftover transient marker. withTransient stamps EVERY node the
 * session inserts (data-carrying or not, so the byte-safety gate holds across
 * the whole span), but accept/rejectSuggestion only clean data-carrying nodes
 * — without this sweep the bare stamps outlive the session and the save gate
 * (transient.ts::hasTransientAiState) never releases. */
function sweepTransientMarkers(editor: SlateEditor): void {
  editor.tf.unsetNodes([getTransientSuggestionKey()], {
    at: [],
    mode: "all",
    match: (n) => n[getTransientSuggestionKey()] === true,
  });
}

/** Resolve one suggestion by id: accept applies the change (insertions stay,
 * deletions are executed), reject reverts it precisely (insertions removed,
 * deletions restored, mark updates undone). Resolving the LAST one sweeps the
 * leftover transient stamps so the byte-safety gate releases. */
export function resolveSuggestion(editor: SlateEditor, id: string, mode: ResolveMode): void {
  const api = editor.getApi(BaseSuggestionPlugin).suggestion;
  const entry = api
    .nodes({ transient: true })
    .find(([node]) => dataListOf(node).some((data) => data.id === id));
  if (!entry) return;
  const data = dataListOf(entry[0]).find((d) => d.id === id);
  if (!data) return;
  const description = {
    createdAt: new Date(data.createdAt),
    keyId: getSuggestionKey(id),
    suggestionId: id,
    type: data.type,
    userId: data.userId,
  };
  editor.tf.withoutNormalizing(() => {
    if (mode === "accept") acceptSuggestion(editor, description);
    else rejectSuggestion(editor, description);
    if (transientSuggestionIds(editor).length === 0) sweepTransientMarkers(editor);
  });
}

/** Resolve every unresolved suggestion, then sweep any leftover transient
 * markers so the byte-safety gate releases even on odd shapes. */
export function resolveAllSuggestions(editor: SlateEditor, mode: ResolveMode): void {
  editor.tf.withoutNormalizing(() => {
    for (const id of transientSuggestionIds(editor)) resolveSuggestion(editor, id, mode);
    sweepTransientMarkers(editor);
  });
}

/** First document node carrying suggestion `id` (review-bar scroll target). */
export function firstSuggestionNode(editor: SlateEditor, id: string): Descendant | null {
  const api = editor.getApi(BaseSuggestionPlugin).suggestion;
  const entry = api
    .nodes({ transient: true })
    .find(([node]) => dataListOf(node).some((data) => data.id === id));
  return entry ? entry[0] : null;
}
