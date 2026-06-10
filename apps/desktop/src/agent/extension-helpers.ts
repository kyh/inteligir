/**
 * Shared formatters for PiExtensionBundle tool results. Each CLI-backed bundle
 * (peekaboo, browser) returns the same content-block shape; centralizing
 * the construction keeps the bundles focused on tool-specific concerns.
 */

export type ToolTextResult = {
  content: [{ type: "text"; text: string }];
  details: Record<string, never>;
};

export function textResult(value: string): ToolTextResult {
  return { content: [{ type: "text", text: value }], details: {} };
}

/**
 * Joined stdout + stderr + non-zero exit code, in the order a human reader
 * expects. Returns "(no output)" for fully silent runs so the agent has
 * something to anchor on.
 */
export function formatCliOutput(result: { stdout: string; stderr: string; code: number }): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
  if (result.code !== 0) parts.push(`[exit ${result.code}]`);
  return parts.join("\n\n") || "(no output)";
}
