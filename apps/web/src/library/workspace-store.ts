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
  readonly panel: RefObject<SidebarActions | null>;
  readonly compose: (event: ComposerEvent) => void;
  readonly showPanelTab: (tab: PanelTab) => void;
  readonly revealPanel: (tab: PanelTab) => void;
  readonly togglePanel: () => void;
  readonly setPaletteOpen: (open: boolean) => void;
}

export const createWorkspaceStore = () => {
  const store = createStore<WorkspaceState>()(() => ({
    composer: COMPOSER_START,
    paletteOpen: false,
    panelTab: "info",
  }));

  const panel: WorkspaceStore["panel"] = { current: null };

  const showPanelTab = (panelTab: PanelTab) => {
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
  } satisfies WorkspaceStore;
};
