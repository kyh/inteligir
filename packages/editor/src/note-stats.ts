// beside the TOC: both walk the editor's own blocks, so the count and the outline agree on what
// the document holds. Published by the serializer's debounce, never per keystroke.

import { NodeApi, type SlateEditor } from "platejs";
import { useSyncExternalStore } from "react";

export type NoteStats = { readonly words: number; readonly characters: number };

const WORDS_PER_MINUTE = 200;

// lowest blocks, so a list counts each item's words apart; a frontmatter node has empty text
// and counts nothing
export function collectNoteStats(editor: SlateEditor): NoteStats {
  let words = 0;
  let characters = 0;
  for (const [block] of editor.api.blocks({ at: [], mode: "lowest" })) {
    const text = NodeApi.string(block);
    characters += text.length;
    words += text.match(/\S+/gu)?.length ?? 0;
  }
  return { words, characters };
}

export function readingMinutes(words: number): number {
  return words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

// keyed by path like the live editor: a note switch mounts a new editor, and the outgoing one's
// numbers must stop answering for the incoming path
const stats = new Map<string, NoteStats>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function publishNoteStats(path: string, next: NoteStats): void {
  const prior = stats.get(path);
  if (prior !== undefined && prior.words === next.words && prior.characters === next.characters) {
    return;
  }
  stats.set(path, next);
  notify();
}

export function clearNoteStats(path: string): void {
  if (stats.delete(path)) notify();
}

export function readNoteStats(path: string): NoteStats | null {
  return stats.get(path) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNoteStats(path: string | null): NoteStats | null {
  return useSyncExternalStore(subscribe, () => (path === null ? null : readNoteStats(path)));
}
