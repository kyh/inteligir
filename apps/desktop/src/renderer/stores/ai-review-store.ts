import { create } from "zustand";

// The notes whose mounted rich editor holds an unresolved AI suggestion
// session. While one pends, that file's autosave is frozen at the pre-session
// bytes (see editor/ai/transient.ts) — the header's save badge reads this
// store to show "Reviewing suggestions" instead of silently claiming Saved
// (#374). Keyed by path because every open tab keeps its editor mounted
// (#369): a background tab's pending review must not relabel the ACTIVE
// tab's badge. Written by markdown-editor's onChange (and cleared on
// unmount); read by the header for the active path.

type AiReviewStore = {
  reviewing: ReadonlySet<string>;
  setReviewing: (path: string, reviewing: boolean) => void;
};

export const useAiReviewStore = create<AiReviewStore>((set, get) => ({
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
