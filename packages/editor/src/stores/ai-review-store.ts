import { create } from "zustand";

// The notes whose mounted rich editor holds an unresolved AI suggestion
// session. While one pends, that file's autosave is frozen at the pre-session
// bytes (see editor/ai/transient.ts) — the status bar's save dot reads this
// store so it says why instead of silently claiming Saved.
// Keyed by path because a pending review must survive the
// unmount/mount overlap of a note switch and never relabel a different
// note's state. Written by markdown-editor's onChange (and cleared on
// unmount); read by the status bar for the open path.

type AiReviewStore = {
  reviewing: ReadonlySet<string>;
  setReviewing: (path: string, reviewing: boolean) => void;
};

export const useAiReviewStore = create<AiReviewStore>()((set, get) => ({
  reviewing: new Set<string>(),
  setReviewing: (path, reviewing) => {
    const current = get().reviewing;
    if (current.has(path) === reviewing) return;
    const next = new Set(current);
    if (reviewing) next.add(path);
    else next.delete(path);
    set({ reviewing: next });
  },
}));
