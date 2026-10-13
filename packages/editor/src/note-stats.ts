// beside the TOC: both walk the editor's own blocks, so the count and the outline agree on what
// the document holds. Published by the serializer's debounce, never per keystroke.

import { NodeApi } from "platejs";
import type { SlateEditor, TElement } from "platejs";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export interface NoteStats {
  readonly words: number;
  readonly characters: number;
}

const WORDS_PER_MINUTE = 200;

// An edit replaces the top-level blocks it touched and keeps every other by identity, so a count
// walks only those.
const statsByBlock = new WeakMap<TElement, NoteStats>();

// lowest blocks, so a list counts each item's words apart; a frontmatter node has empty text
// and counts nothing
const blockStats = (editor: SlateEditor, block: TElement, index: number): NoteStats => {
  const cached = statsByBlock.get(block);
  if (cached !== undefined) {
    return cached;
  }
  let words = 0;
  let characters = 0;
  for (const [lowest] of editor.api.blocks({ at: [index], mode: "lowest" })) {
    const text = NodeApi.string(lowest);
    characters += text.length;
    words += text.match(/\S+/gu)?.length ?? 0;
  }
  const counted = { characters, words };
  statsByBlock.set(block, counted);
  return counted;
};

export const collectNoteStats = (editor: SlateEditor): NoteStats => {
  let words = 0;
  let characters = 0;
  for (const [index, block] of editor.children.entries()) {
    const counted = blockStats(editor, block, index);
    words += counted.words;
    characters += counted.characters;
  }
  return { characters, words };
};

export const readingMinutes = (words: number): number =>
  words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));

// keyed by path like the live editor: a note switch mounts a new editor, and the outgoing one's
// numbers must stop answering for the incoming path
const statsStore = createStore<ReadonlyMap<string, NoteStats>>()(() => new Map());

const sameStats = (a: NoteStats | undefined, b: NoteStats): boolean =>
  a !== undefined && a.words === b.words && a.characters === b.characters;

export const publishNoteStats = (path: string, next: NoteStats): void => {
  statsStore.setState(
    (stats) => (sameStats(stats.get(path), next) ? stats : new Map(stats).set(path, next)),
    true,
  );
};

export const clearNoteStats = (path: string): void => {
  statsStore.setState((stats) => {
    if (!stats.has(path)) {
      return stats;
    }
    const next = new Map(stats);
    next.delete(path);
    return next;
  }, true);
};

export const readNoteStats = (path: string): NoteStats | null =>
  statsStore.getState().get(path) ?? null;

export const useNoteStats = (path: string | null): NoteStats | null =>
  useStore(statsStore, (stats) => (path === null ? null : (stats.get(path) ?? null)));
