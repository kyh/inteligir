// The built-in agent's one definition, beside the code that runs it: its model and effort, and the
// library tools it may call. The same bytes for every account (owner decision: one model for
// everyone); each thread freezes the definition at its first turn, and takes up a deploy that
// changes it at the start of its next turn, never mid-turn (`./thread-request`, `./thread-loop`),
// and the cell runs every call it asks for (`./agent-tools`).

// one model for everyone, at the effort Opus 5.5 defaults to, written out, so a change of default
// changes nothing here
export const AGENT_MODEL = { effort: "medium", id: "claude-opus-5-5" } as const;

// the most output one call may ask for, whatever the turn could buy: Opus 5.5's synchronous
// ceiling is far above it, and a reply past it is a runaway
export const AGENT_MAX_TOKENS = 64_000;

// every library tool the agent may call, by the name it is listed under, and whether it runs at
// once or waits for the person: an allowlist, so a tool the library gains later stays off until it
// is named here. Deleting asks, since it is the one change a person approves first; every other
// change joins the turn's one undoable set. undo_change is left out: the person's Undo is a
// button, and an agent undoing its own turn would undo it under them
export const AGENT_TOOL_POLICIES = {
  add_highlight: "run",
  create_note: "run",
  delete_items: "ask",
  edit_item: "run",
  item_history: "run",
  list_highlights: "run",
  list_items: "run",
  list_tags_and_folders: "run",
  organize_items: "run",
  read_item: "run",
  save_link: "run",
  search_library: "run",
} as const;

export type AgentToolName = keyof typeof AGENT_TOOL_POLICIES;

export const isAgentToolName = (name: string): name is AgentToolName =>
  Object.hasOwn(AGENT_TOOL_POLICIES, name);
