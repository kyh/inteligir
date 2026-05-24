import { z } from "zod";

// ---------------------------------------------------------------------------
// MCP server configuration — remote (HTTP / SSE) servers the agent connects to
// and exposes as tools. Persisted to ~/.inteligir/mcp.json in the familiar
// `{ mcpServers: { "<name>": { url, headers } } }` shape so the file is
// hand-editable, and surfaced through the Settings UI for CRUD.
// ---------------------------------------------------------------------------

/** Tool name prefix for every MCP-sourced tool. Lets other layers (active-tools
 *  restore) recognize MCP tools without knowing which server they came from. */
export const MCP_TOOL_PREFIX = "mcp_";

export const McpServerConfigSchema = z.object({
  /** Remote MCP endpoint. Streamable HTTP is tried first, then SSE. */
  url: z.string().url(),
  /** Optional headers sent with every request (e.g. Authorization). */
  headers: z.record(z.string(), z.string()).optional(),
  /** Disabled servers are kept in config but not connected. Defaults to true. */
  enabled: z.boolean().optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerConfigSchema).default({}),
});

export type McpConfig = z.infer<typeof McpConfigSchema>;

/** Flattened projection sent over IPC — `name` is the config key. */
export type McpServer = {
  name: string;
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
};

export type McpServerList = {
  servers: McpServer[];
};

export const AddMcpServerParamsSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  url: z.string().url("Must be a valid URL"),
  headers: z.record(z.string(), z.string()).optional(),
});

export type AddMcpServerParams = z.infer<typeof AddMcpServerParamsSchema>;

export const SetMcpServerEnabledParamsSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});

export type SetMcpServerEnabledParams = z.infer<typeof SetMcpServerEnabledParamsSchema>;

/**
 * Turn a server name into a tool-name-safe slug. Tool names the LLM sees must
 * be `[a-zA-Z0-9_-]`; server names are free-form, so collapse everything else
 * to underscores.
 */
export function mcpServerSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "server";
}
