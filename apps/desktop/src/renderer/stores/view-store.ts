import { create } from "zustand";

// Transient UI/view state for the shell (not persisted): whether the user has
// pinned the agent response popover open. Everything else about the popover's
// visibility is derived from live agent activity in the bottom composer.
type ViewStore = {
  responsePinned: boolean;
  togglePinned: () => void;
  setPinned: (pinned: boolean) => void;
};

export const useViewStore = create<ViewStore>((set) => ({
  responsePinned: false,
  togglePinned: () => set((s) => ({ responsePinned: !s.responsePinned })),
  setPinned: (responsePinned) => set({ responsePinned }),
}));
