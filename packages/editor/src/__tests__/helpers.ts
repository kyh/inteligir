import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import type { Decoration, DecorationSet } from "@codemirror/view";
import { markdownEditorExtensions } from "../markdown-editor-extensions";

/**
 * EditorState with the full house stack and a COMPLETED parse: the initial
 * field build may have seen a partial tree, so after forcing the parse a
 * selection transaction rebuilds the decoration fields against the full one.
 */
export const stateWithStack = (doc: string, anchor = 0, extra: Extension = []): EditorState => {
  const initial = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor),
    extensions: [markdownEditorExtensions(), extra],
  });
  ensureSyntaxTree(initial, initial.doc.length, 10_000);
  return initial.update({ selection: EditorSelection.single(anchor) }).state;
};

interface DecoEntry {
  from: number;
  to: number;
  deco: Decoration;
}

const decoEntries = (set: DecorationSet): DecoEntry[] => {
  const entries: DecoEntry[] = [];
  for (let iter = set.iter(); iter.value; iter.next()) {
    entries.push({ from: iter.from, to: iter.to, deco: iter.value });
  }
  return entries;
};

const decoClass = (deco: Decoration): string => {
  const spec = deco.spec as { class?: string; attributes?: { class?: string } };
  return spec.class ?? spec.attributes?.class ?? "";
};

/** Entries whose class list contains `cls`, as [from, to] pairs. */
export const rangesWithClass = (set: DecorationSet, cls: string): [number, number][] =>
  decoEntries(set)
    .filter((entry) => decoClass(entry.deco).split(/\s+/).includes(cls))
    .map((entry) => [entry.from, entry.to]);

const hasWidget = (deco: Decoration): boolean => {
  const spec = deco.spec as { widget?: unknown };
  return spec.widget !== undefined && spec.widget !== null;
};

/** Entries that replace [from, to] with a widget. */
export const widgetRanges = (set: DecorationSet): [number, number][] =>
  decoEntries(set)
    .filter((entry) => hasWidget(entry.deco))
    .map((entry) => [entry.from, entry.to]);

/** Position of `needle` in `haystack`; throws instead of returning -1. */
export const posOf = (haystack: string, needle: string): number => {
  const pos = haystack.indexOf(needle);
  if (pos < 0) throw new Error(`fixture does not contain ${needle}`);
  return pos;
};
