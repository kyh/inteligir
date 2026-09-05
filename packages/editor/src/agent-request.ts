// The app registers the actions at mount, so the editor package never imports the shell. A
// registry rather than a value store: a deep node (the selection toolbar, a `#tag` chip) has
// no route to the shell's owner, and an action it calls needs no adopt-and-consume dance.

import { create } from "zustand";

export interface AgentRequestActions {
  askAboutSelection: (selectionText: string) => void;
  // the rail shows that tag's notes
  showTag: (tag: string) => void;
}

type AgentRequestState = { actions: AgentRequestActions | null };

export const useAgentRequestActions = create<AgentRequestState>()(() => ({ actions: null }));

export function setAgentRequestActions(actions: AgentRequestActions | null): void {
  useAgentRequestActions.setState({ actions });
}
