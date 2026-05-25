import { z } from "zod";

// ---------------------------------------------------------------------------
// MCP connector configuration — remote (HTTP / SSE) MCP servers that get
// registered with executor (the bundled MCP client / integration layer) as
// sources, so the agent's code-mode `execute` tool can reach them. Persisted
// to ~/.inteligir/mcp.json in the familiar
// `{ mcpServers: { "<name>": { url, headers } } }` shape so the file is
// hand-editable, and surfaced through the Settings UI for CRUD.
// ---------------------------------------------------------------------------

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
 * Turn a connector name into a namespace-safe slug used as executor's source
 * id / namespace. Must be `[a-z0-9_]`; connector names are free-form, so
 * collapse everything else to underscores.
 */
export function mcpServerSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "server";
}
