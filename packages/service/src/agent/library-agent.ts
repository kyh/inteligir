// The built-in agent's one definition, beside the code that runs it: its model and effort, and the
// library tools it may call. The same bytes for every account (owner decision: one model for
// everyone); each thread freezes the definition at its first turn, and takes up a deploy that
// changes it at the start of its next turn, never mid-turn (`./thread-request`, `./thread-loop`),
// and the cell runs every call it asks for (`./agent-tools`).

// one model for everyone, Sonnet 5.5, at medium effort: it defaults to high, its levels are
// recalibrated from earlier models', and medium is where Anthropic's guidance starts multistep tool
// use, which every turn of ours is
export const AGENT_MODEL = { effort: "medium", id: "claude-sonnet-5-5" } as const;

// the most output one call may ask for: far below Sonnet 5.5's ceiling, and a reply past it is a
// runaway, which it ends at about 32 cents
export const AGENT_MAX_TOKENS = 32_000;

// the most replies one turn may take; the turn ends `budget` before the next, and the person asks
// the agent to go on, which a filing pass over many items needs and a loop does not
export const AGENT_MAX_STEPS = 20;

// every library tool the agent may call, by the name it is listed under, and whether it runs at
// once or waits for the person: an allowlist, so a tool the library gains later stays off until it
// is named here. Deleting asks, and so does saving a link: the cloud reads a saved page, so its
// address reaches that site, the one way the agent's words leave the library, and no Undo recalls
// a request. Every other change joins the turn's one undoable set, which the person's Undo this
// turn takes back
export const AGENT_TOOL_POLICIES = {
  create_note: "run",
  delete_items: "ask",
  edit_item: "run",
  list_items: "run",
  list_tags_and_folders: "run",
  organize_items: "run",
  read_item: "run",
  save_link: "ask",
  search_library: "run",
} as const;

export type AgentToolName = keyof typeof AGENT_TOOL_POLICIES;

export const isAgentToolName = (name: string): name is AgentToolName =>
  Object.hasOwn(AGENT_TOOL_POLICIES, name);
