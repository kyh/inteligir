import { create } from "zustand";

// Transient UI/view state for the shell (not persisted): whether the user has
// pinned the agent response popover open, and which main surface fills the
// workspace (the editor panes, the link-graph view, or the tasks view).
// Everything else about the popover's visibility is derived from live agent
// activity in the bottom composer.

/** The workspace's main surface: the note editor, the link graph, or the
 * whole-vault tasks view. */
export type WorkspaceSurface = "editor" | "graph" | "tasks";

type ViewStore = {
  responsePinned: boolean;
  togglePinned: () => void;
  setPinned: (pinned: boolean) => void;
  surface: WorkspaceSurface;
  setSurface: (surface: WorkspaceSurface) => void;
  /** The read-only past-chat browser dialog (palette: "Browse past chats"). */
  pastChatsOpen: boolean;
  setPastChatsOpen: (open: boolean) => void;
};

export const useViewStore = create<ViewStore>()((set) => ({
  responsePinned: false,
  togglePinned: () => set((s) => ({ responsePinned: !s.responsePinned })),
  setPinned: (responsePinned) => set({ responsePinned }),
  surface: "editor",
  setSurface: (surface) => set({ surface }),
  pastChatsOpen: false,
  setPastChatsOpen: (pastChatsOpen) => set({ pastChatsOpen }),
}));
