// The editor's one ask of the agent surface: "take this selection to the
// composer" (Moss's send-selection-to-Agent). A module store in the
// comment-store discipline — the app registers the action once at mount, and
// the selection toolbar renders its button only while one is registered, so
// the editor package never imports the shell.

export interface AgentRequestActions {
  /** Open the action composer seeded with this selection. */
  askAboutSelection: (selectionText: string) => void;
}

let installed: AgentRequestActions | null = null;
const listeners = new Set<() => void>();

export function setAgentRequestActions(actions: AgentRequestActions | null): void {
  installed = actions;
  for (const listener of listeners) listener();
}

export function agentRequestActions(): AgentRequestActions | null {
  return installed;
}

/** useSyncExternalStore-shaped subscription for the toolbar's button. */
export function subscribeAgentRequestActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
