import { create } from "zustand";

// Whether the mounted rich editor holds an unresolved AI suggestion session.
// While one pends, autosave is frozen at the pre-session bytes (see
// editor/ai/transient.ts) — the header's save badge reads this store to show
// "Reviewing suggestions" instead of silently claiming Saved (#374). Written
// by markdown-editor's onChange (and cleared on unmount); read by the header.

type AiReviewStore = {
  reviewing: boolean;
  setReviewing: (reviewing: boolean) => void;
};

export const useAiReviewStore = create<AiReviewStore>((set, get) => ({
  reviewing: false,
  setReviewing: (reviewing) => {
    if (get().reviewing !== reviewing) set({ reviewing });
  },
}));
