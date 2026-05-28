/**
 * Shared formatters for PiExtensionBundle tool results. Each CLI-backed bundle
 * (gws, peekaboo, browser) returns the same content-block shape; centralizing
 * the construction keeps the bundles focused on tool-specific concerns.
 */

export type ToolContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolTextResult = {
  content: [{ type: "text"; text: string }];
  details: Record<string, never>;
};

export type ToolResult = {
  content: ToolContentBlock[];
  details: Record<string, never>;
};

export function textResult(value: string): ToolTextResult {
  return { content: [{ type: "text", text: value }], details: {} };
}

/**
 * Map MCP tool-result content blocks (text/image, plus anything else folded to
 * text) to the pi tool-result shape. Shared by extensions that proxy an MCP
 * server's tools.
 */
export function mcpContentToToolResult(content: unknown, isError: boolean): ToolResult {
  const blocks: ToolContentBlock[] = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b["type"] === "text" && typeof b["text"] === "string") {
        blocks.push({ type: "text", text: b["text"] });
      } else if (
        b["type"] === "image" &&
        typeof b["data"] === "string" &&
        typeof b["mimeType"] === "string"
      ) {
        blocks.push({ type: "image", data: b["data"], mimeType: b["mimeType"] });
      } else {
        blocks.push({ type: "text", text: JSON.stringify(block) });
      }
    }
  }
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: isError ? "(error)" : "(no output)" });
  } else if (isError) {
    blocks.unshift({ type: "text", text: "[tool reported an error]" });
  }
  return { content: blocks, details: {} };
}

/**
 * Joined stdout + stderr + non-zero exit code, in the order a human reader
 * expects. Returns "(no output)" for fully silent runs so the agent has
 * something to anchor on.
 */
export function formatCliOutput(result: {
  stdout: string;
  stderr: string;
  code: number;
}): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
  if (result.code !== 0) parts.push(`[exit ${result.code}]`);
  return parts.join("\n\n") || "(no output)";
}
