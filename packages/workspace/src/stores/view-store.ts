import { create } from "zustand";

// Transient UI/view state for the shell (not persisted): whether the user has
// pinned the agent response popover open, and which main surface fills the
// workspace. Everything else about the popover's visibility is derived from
// live agent activity in the bottom composer.

/** The workspace's main surface. Settings is one of these rather than a dialog:
 * it is a place the user goes, and a notice raised anywhere in the app sends
 * them there with `setSurface("settings")`. */
export type WorkspaceSurface = "editor" | "graph" | "tasks" | "settings";

/** What the breadcrumb says when the surface is not a note. */
export const SURFACE_LABEL: Record<Exclude<WorkspaceSurface, "editor">, string> = {
  graph: "Graph",
  tasks: "Tasks",
  settings: "Settings",
};

type ViewStore = {
  responsePinned: boolean;
  togglePinned: () => void;
  setPinned: (pinned: boolean) => void;
  surface: WorkspaceSurface;
  setSurface: (surface: WorkspaceSurface) => void;
  /** The read-only past-chat browser dialog (palette: "Browse past chats"). */
  pastChatsOpen: boolean;
  setPastChatsOpen: (open: boolean) => void;
  reset: () => void;
};

export const useViewStore = create<ViewStore>()((set) => ({
  responsePinned: false,
  togglePinned: () => set((s) => ({ responsePinned: !s.responsePinned })),
  setPinned: (responsePinned) => set({ responsePinned }),
  surface: "editor",
  setSurface: (surface) => set({ surface }),
  pastChatsOpen: false,
  setPastChatsOpen: (pastChatsOpen) => set({ pastChatsOpen }),
  reset: () => set({ responsePinned: false, surface: "editor", pastChatsOpen: false }),
}));
