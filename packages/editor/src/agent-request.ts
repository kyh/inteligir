// The editor's one ask of the agent surface: "take this selection to the
// composer" (Moss's send-selection-to-Agent). A store in the comment-store
// discipline — the app registers the action once at mount, and the selection
// toolbar renders its button only while one is registered, so the editor
// package never imports the shell.

import { create } from "zustand";

export interface AgentRequestActions {
  /** Open the action composer seeded with this selection. */
  askAboutSelection: (selectionText: string) => void;
}

type AgentRequestState = { actions: AgentRequestActions | null };

/** Subscribe with a selector: `useAgentRequestActions((s) => s.actions)`. */
export const useAgentRequestActions = create<AgentRequestState>()(() => ({ actions: null }));

export function setAgentRequestActions(actions: AgentRequestActions | null): void {
  useAgentRequestActions.setState({ actions });
}
