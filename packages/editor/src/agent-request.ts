// The app registers the action at mount, so the editor package never imports the shell.

import { create } from "zustand";

export interface AgentRequestActions {
  askAboutSelection: (selectionText: string) => void;
}

type AgentRequestState = { actions: AgentRequestActions | null };

export const useAgentRequestActions = create<AgentRequestState>()(() => ({ actions: null }));

export function setAgentRequestActions(actions: AgentRequestActions | null): void {
  useAgentRequestActions.setState({ actions });
}
