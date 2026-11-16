// What the tab's shell holds beside its address (`./library-search.ts`) and its window's layout
// (`./prefs.ts`): which of the panel's tabs shows, whether ⌘P is up, and the agent's composer. Made
// once a tab (`./library-tab.ts`) and carried on the page's library, so a command, the editor's
// host and the screen that draws each move one holder, in React or out of it.

import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { COMPOSER_START, composerAfter } from "./agent/agent-composer";
import type { ComposerEvent, ComposerState } from "./agent/agent-composer";
import { windowLayout } from "./prefs";

export const PANEL_TABS = ["info", "agent"] as const;
type PanelTab = (typeof PANEL_TABS)[number];

interface WorkspaceState {
  readonly panelTab: PanelTab;
  readonly paletteOpen: boolean;
  readonly composer: ComposerState;
}

export interface WorkspaceStore {
  readonly store: StoreApi<WorkspaceState>;
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
  const showPanelTab = (panelTab: PanelTab): void => {
    store.setState({ panelTab });
  };
  return {
    compose: (event) => {
      store.setState(({ composer }) => ({ composer: composerAfter(composer, event) }));
    },
    revealPanel: (tab) => {
      showPanelTab(tab);
      windowLayout.setState({ panelOpen: true });
    },
    setPaletteOpen: (paletteOpen) => {
      store.setState({ paletteOpen });
    },
    showPanelTab,
    store,
    togglePanel: () => {
      windowLayout.setState(({ panelOpen }) => ({ panelOpen: !panelOpen }));
    },
  };
};
