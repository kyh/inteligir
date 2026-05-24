/**
 * MCP extension — connects to remote (HTTP / SSE) Model Context Protocol
 * servers configured in ~/.inteligir/mcp.json and exposes each server's tools
 * as pi tools.
 *
 * No setup() — nothing to install. register() runs at every agent start: it
 * reads the enabled servers, connects (Streamable HTTP first, SSE fallback),
 * lists their tools, and registers one pi tool per remote tool. Per-server
 * failures are logged and skipped so one unreachable server can't block the
 * agent or the other servers. Connections are closed on session_shutdown.
 *
 * Tool names are namespaced `mcp_<server-slug>_<tool>` so they can't collide
 * across servers and so the active-tools restore can recognize them.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ExtensionAPI } from "@repo/pi-driver";
import type { TSchema } from "@sinclair/typebox";

import { getMcpServers } from "@/main/mcp/mcp-servers";
import type { PiExtensionBundle } from "@/agent/extension";
import { MCP_TOOL_PREFIX, mcpServerSlug, type McpServer } from "@/shared/mcp";

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 120_000;

type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [key: string]: unknown };

const mcpExtension: PiExtensionBundle = {
  name: "mcp",
  register: () => async (pi) => {
    const servers = getMcpServers().listEnabled();
    if (servers.length === 0) return;

    const clients: Client[] = [];

    // Connect + register sequentially so every tool is registered before this
    // factory resolves (pi awaits it). Per-server errors are isolated.
    for (const server of servers) {
      try {
        const client = await connect(server);
        clients.push(client);
        await registerServerTools(pi, server, client);
      } catch (err) {
        console.error(
          `[mcp] failed to connect to "${server.name}" (${server.url}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (clients.length > 0) {
      pi.on("session_shutdown", async () => {
        await Promise.all(clients.map((c) => c.close().catch(() => {})));
      });
    }
  },
};

export default mcpExtension;

async function registerServerTools(
  pi: ExtensionAPI,
  server: McpServer,
  client: Client,
): Promise<void> {
  const slug = mcpServerSlug(server.name);
  const { tools } = await client.listTools();

  for (const tool of tools) {
    const toolName = `${MCP_TOOL_PREFIX}${slug}_${tool.name}`;
    pi.registerTool({
      name: toolName,
      label: `${server.name}: ${tool.name}`,
      description: tool.description ?? `${tool.name} (via MCP server "${server.name}")`,
      // MCP inputSchema is plain JSON Schema. pi-ai's tool validation accepts
      // raw JSON Schema objects (no TypeBox metadata required), so pass it
      // straight through rather than translating to TypeBox.
      parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as unknown as TSchema,
      execute: async (_toolCallId, params) => {
        try {
          const result = await client.callTool(
            { name: tool.name, arguments: (params as Record<string, unknown>) ?? {} },
            undefined,
            { timeout: CALL_TIMEOUT_MS },
          );
          return toToolResult(result.content as McpContentBlock[], result.isError === true);
        } catch (err) {
          return textResult(
            `MCP tool "${tool.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    });
  }
}

async function connect(server: McpServer): Promise<Client> {
  const url = new URL(server.url);
  const requestInit: RequestInit | undefined = server.headers
    ? { headers: server.headers }
    : undefined;

  // Streamable HTTP is the current transport; fall back to the legacy SSE
  // transport for servers that only speak SSE.
  const httpClient = new Client({ name: "inteligir", version: "1.0.0" });
  try {
    const transport = new StreamableHTTPClientTransport(url, { requestInit });
    await withTimeout(httpClient.connect(transport), CONNECT_TIMEOUT_MS, server.name);
    return httpClient;
  } catch (httpErr) {
    await httpClient.close().catch(() => {});
    const sseClient = new Client({ name: "inteligir", version: "1.0.0" });
    try {
      const sseTransport = new SSEClientTransport(url, { requestInit });
      await withTimeout(sseClient.connect(sseTransport), CONNECT_TIMEOUT_MS, server.name);
      return sseClient;
    } catch {
      await sseClient.close().catch(() => {});
      // Surface the original (HTTP) error — it's the primary transport.
      throw httpErr;
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out connecting to "${label}" after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type McpToolResult = { content: ToolContent[]; details: Record<string, never> };

function toToolResult(blocks: McpContentBlock[], isError: boolean): McpToolResult {
  const content: ToolContent[] = [];

  for (const block of blocks ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      content.push({ type: "text", text: block.text });
    } else if (
      block.type === "image" &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string"
    ) {
      content.push({ type: "image", data: block.data, mimeType: block.mimeType });
    } else {
      // audio / resource / unknown — fold into text so nothing is silently lost.
      content.push({ type: "text", text: JSON.stringify(block) });
    }
  }

  if (content.length === 0) {
    content.push({ type: "text", text: isError ? "(MCP tool error)" : "(no output)" });
  } else if (isError) {
    content.unshift({ type: "text", text: "[MCP tool reported an error]" });
  }

  return { content, details: {} };
}

function textResult(value: string): McpToolResult {
  return { content: [{ type: "text", text: value }], details: {} };
}
