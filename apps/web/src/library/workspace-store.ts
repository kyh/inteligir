// What the tab's shell holds beside its address (`./library-search.ts`) and its window's layout
// (`./prefs.ts`): which of the panel's tabs shows, whether ⌘P is up, and the agent's composer. Made
// once a tab (`./library-tab.ts`) and carried on the page's library, so a command, the editor's
// host and the screen that draws each move one holder, in React or out of it.

import type { SidebarActions } from "@repo/ui/components/sidebar-core";
import type { RefObject } from "react";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { COMPOSER_START, composerAfter } from "./agent/agent-composer";
import type { ComposerEvent, ComposerState } from "./agent/agent-composer";

export const PANEL_TABS = ["info", "agent"] as const;
type PanelTab = (typeof PANEL_TABS)[number];

interface WorkspaceState {
  readonly panelTab: PanelTab;
  readonly paletteOpen: boolean;
  readonly composer: ComposerState;
}

export interface WorkspaceStore {
  readonly store: StoreApi<WorkspaceState>;
  // the panel's own open and toggle, which the layout's sidebar answers: open is the window's pref
  // above the breakpoint and a sheet's own below it, and only the sidebar tells them apart
  readonly panel: RefObject<SidebarActions | null>;
  readonly compose: (event: ComposerEvent) => void;
  readonly showPanelTab: (tab: PanelTab) => void;
  // the panel open, on this tab
  readonly revealPanel: (tab: PanelTab) => void;
  readonly togglePanel: () => void;
  readonly setPaletteOpen: (open: boolean) => void;
}

export const createWorkspaceStore = (): WorkspaceStore => {
  const store = createStore<WorkspaceState>()(() => ({
    composer: COMPOSER_START,
    paletteOpen: false,
    panelTab: "info",
  }));
  const panel: WorkspaceStore["panel"] = { current: null };
  const showPanelTab = (panelTab: PanelTab): void => {
    store.setState({ panelTab });
  };
  return {
    compose: (event) => {
      store.setState(({ composer }) => ({ composer: composerAfter(composer, event) }));
    },
    panel,
    revealPanel: (tab) => {
      showPanelTab(tab);
      panel.current?.open();
    },
    setPaletteOpen: (paletteOpen) => {
      store.setState({ paletteOpen });
    },
    showPanelTab,
    store,
    togglePanel: () => {
      panel.current?.toggle();
    },
  };
};
