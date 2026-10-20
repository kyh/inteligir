// the connectors Settings offers in one click, each one a person who saves, reads and writes
// reaches for, never a developer's tool. A sign-in preset is signed in to as soon as it is added;
// a keyless one works once it is there.
export interface ConnectorPreset {
  // the row's name in the agent's config, which the add request's grammar holds
  name: string;
  label: string;
  description: string;
  url: string;
  signIn: boolean;
}

export const CONNECTOR_PRESETS: readonly ConnectorPreset[] = [
  {
    description: "Pages and databases",
    label: "Notion",
    name: "notion",
    signIn: true,
    url: "https://mcp.notion.com/mcp",
  },
  {
    description: "Search and read the web",
    label: "Exa",
    name: "exa",
    signIn: false,
    url: "https://mcp.exa.ai/mcp",
  },
];
