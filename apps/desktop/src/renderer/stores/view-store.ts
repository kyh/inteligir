import { create } from "zustand";

// Transient UI/view state for the shell (not persisted): whether the user has
// pinned the agent response popover open, and which main surface fills the
// workspace (the editor panes, or the link-graph view). Everything else about
// the popover's visibility is derived from live agent activity in the bottom
// composer.

/** The workspace's main surface: the note editor, or the link graph. */
type WorkspaceSurface = "editor" | "graph";

type ViewStore = {
  responsePinned: boolean;
  togglePinned: () => void;
  setPinned: (pinned: boolean) => void;
  surface: WorkspaceSurface;
  setSurface: (surface: WorkspaceSurface) => void;
};

export const useViewStore = create<ViewStore>((set) => ({
  responsePinned: false,
  togglePinned: () => set((s) => ({ responsePinned: !s.responsePinned })),
  setPinned: (responsePinned) => set({ responsePinned }),
  surface: "editor",
  setSurface: (surface) => set({ surface }),
}));
