// The built-in agent's one definition, beside the code that runs it: its name, its model, the one
// MCP server it reaches (this deployment's connector) and the tools it may call there. Each
// target's `agent.md` is written from it by `scripts/agent-files.ts` and synced to Managed Agents
// by `ant apply`; a preview's session sends the same definition as its overrides
// (`./session-agent`), so a PR's agent is the one its preview runs. Node runs that script over
// this file as it stands, so it imports nothing.

export const AGENT_NAME = "Inteligir library agent";

export const AGENT_DESCRIPTION =
  "Files, tags, summarizes and edits one person's Inteligir library, through its connector alone.";

// one model for everyone (owner decision), at the effort Opus 5.5 defaults to, written out since a
// session's model override replaces the agent's whole model and keeps no effort it does not carry
export const AGENT_MODEL = { effort: "medium", id: "claude-opus-5-5" } as const;

// the agent's one server: a session's vault holds the credential for its address
const LIBRARY_SERVER_NAME = "library";

// every connector tool the agent may call, by the name the connector lists it under, and whether
// it runs at once or waits for the person: an allowlist, so a tool the connector gains later stays
// off until it is named here. Deleting asks, since it is the one change a person approves first;
// every other change joins the turn's one undoable set. undo_change is left out: the person's
// Undo is a button, and an agent undoing its own turn would undo it under them
export const AGENT_TOOL_POLICIES = {
  add_highlight: "always_allow",
  create_note: "always_allow",
  delete_items: "always_ask",
  edit_item: "always_allow",
  item_history: "always_allow",
  list_highlights: "always_allow",
  list_items: "always_allow",
  list_tags_and_folders: "always_allow",
  organize_items: "always_allow",
  read_item: "always_allow",
  save_link: "always_allow",
  search_library: "always_allow",
} as const;

// the agent's `tools`: the connector's toolset and nothing else, no agent toolset (no shell, no
// files, no web) and no skills, which would need the toolset's `read`
export const agentTools = () => [
  {
    configs: Object.entries(AGENT_TOOL_POLICIES).map(([name, policy]) => ({
      enabled: true,
      name,
      permission_policy: { type: policy },
    })),
    default_config: { enabled: false },
    mcp_server_name: LIBRARY_SERVER_NAME,
    type: "mcp_toolset" as const,
  },
];

// the agent's `mcp_servers`: the connector at `url`, with no credential, which the vault holds
export const agentMcpServers = (url: string) => [
  { name: LIBRARY_SERVER_NAME, type: "url" as const, url },
];
