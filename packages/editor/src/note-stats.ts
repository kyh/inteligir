// beside the TOC: both walk the editor's own blocks, so the count and the outline agree on what
// the document holds. Published by the serializer's debounce, never per keystroke.

import { NodeApi } from "platejs";
import type { SlateEditor, TElement } from "platejs";
import { useSyncExternalStore } from "react";

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
const stats = new Map<string, NoteStats>();
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const publishNoteStats = (path: string, next: NoteStats): void => {
  const prior = stats.get(path);
  if (prior !== undefined && prior.words === next.words && prior.characters === next.characters) {
    return;
  }
  stats.set(path, next);
  notify();
};

export const clearNoteStats = (path: string): void => {
  if (stats.delete(path)) {
    notify();
  }
};

export const readNoteStats = (path: string): NoteStats | null => stats.get(path) ?? null;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useNoteStats = (path: string | null): NoteStats | null =>
  useSyncExternalStore(subscribe, () => (path === null ? null : readNoteStats(path)));
