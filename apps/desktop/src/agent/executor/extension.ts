/**
 * Executor (code mode) extension — surfaces executor's sandboxed `execute`
 * tool (and `resume`) to the agent.
 *
 * Executor runs as a child `executor mcp` process (managed by
 * main/executor/executor-process.ts) and acts as the MCP client / integration
 * layer. Instead of registering each remote tool individually, the agent gets
 * a single `execute` tool: it writes TypeScript that calls a typed `tools.*`
 * catalog (discover, describe, invoke) and only the returned data flows back —
 * far less context than wiring hundreds of tools, and the model can compose
 * and filter in code.
 *
 * No setup() — the executor binary ships as a bundled dependency. register()
 * ensures the process is running, then mirrors its MCP tools (execute, resume)
 * as pi tools. Per-call failures are surfaced as tool text.
 */

import type { ExtensionAPI } from "@repo/pi-driver";
import type { TSchema } from "@sinclair/typebox";

import { getExecutorProcess } from "@/main/executor/executor-process";
import type { PiExtensionBundle } from "@/agent/extension";

const CALL_TIMEOUT_MS = 300_000;

type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [key: string]: unknown };

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type CodeModeToolResult = { content: ToolContent[]; details: Record<string, never> };

const executorExtension: PiExtensionBundle = {
  name: "executor",
  register: () => async (pi) => {
    const client = await getExecutorProcess().start();
    if (!client) {
      console.warn("[executor] not available — code-mode tools will not be registered");
      return;
    }

    let tools;
    try {
      ({ tools } = await client.listTools());
    } catch (err) {
      console.error("[executor] failed to list tools:", err);
      return;
    }

    for (const tool of tools) {
      registerProxyTool(pi, tool.name, tool.description, tool.inputSchema);
    }
  },
};

export default executorExtension;

function registerProxyTool(
  pi: ExtensionAPI,
  name: string,
  description: string | undefined,
  inputSchema: unknown,
): void {
  pi.registerTool({
    name,
    label: name,
    description: description ?? name,
    // Executor exposes plain JSON Schema; pi-ai's tool validation accepts it
    // directly (no TypeBox translation needed).
    parameters: (inputSchema ?? { type: "object", properties: {} }) as unknown as TSchema,
    execute: async (_toolCallId, params) => {
      const client = getExecutorProcess().getClient();
      if (!client) return textResult(`executor is not running — cannot run "${name}".`);
      try {
        const result = await client.callTool(
          { name, arguments: (params as Record<string, unknown>) ?? {} },
          undefined,
          { timeout: CALL_TIMEOUT_MS },
        );
        return toToolResult(result.content as McpContentBlock[], result.isError === true);
      } catch (err) {
        return textResult(`"${name}" failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}

function toToolResult(blocks: McpContentBlock[], isError: boolean): CodeModeToolResult {
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
      content.push({ type: "text", text: JSON.stringify(block) });
    }
  }
  if (content.length === 0) {
    content.push({ type: "text", text: isError ? "(error)" : "(no output)" });
  } else if (isError) {
    content.unshift({ type: "text", text: "[tool reported an error]" });
  }
  return { content, details: {} };
}

function textResult(value: string): CodeModeToolResult {
  return { content: [{ type: "text", text: value }], details: {} };
}
