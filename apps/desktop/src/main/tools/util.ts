import path from "node:path";

// ---------------------------------------------------------------------------
// Shared constants & helpers for agent tools
// ---------------------------------------------------------------------------

export const MAX_OUTPUT_BYTES = 50 * 1024;
export const MAX_OUTPUT_LINES = 2000;

/**
 * Truncate output keeping the tail (last N lines / bytes).
 * Used by bash where recent output is most relevant.
 */
export function truncateTail(
  output: string,
  maxBytes = MAX_OUTPUT_BYTES,
  maxLines = MAX_OUTPUT_LINES,
): { content: string; truncated: boolean } {
  const bytes = Buffer.byteLength(output, "utf-8");
  if (bytes <= maxBytes) {
    const lines = output.split("\n");
    if (lines.length <= maxLines) {
      return { content: output, truncated: false };
    }
    return { content: lines.slice(-maxLines).join("\n"), truncated: true };
  }
  const buf = Buffer.from(output, "utf-8");
  const sliced = buf.subarray(buf.length - maxBytes).toString("utf-8");
  const idx = sliced.indexOf("\n");
  return {
    content: idx >= 0 ? sliced.substring(idx + 1) : sliced,
    truncated: true,
  };
}

/**
 * Truncate output keeping the head (first N bytes).
 * Used by read, grep, find, ls where beginning is most relevant.
 */
export function truncateHead(
  output: string,
  maxBytes = MAX_OUTPUT_BYTES,
): { content: string; truncated: boolean } {
  if (Buffer.byteLength(output, "utf-8") <= maxBytes) {
    return { content: output, truncated: false };
  }
  const buf = Buffer.from(output, "utf-8");
  let content = buf.subarray(0, maxBytes).toString("utf-8");
  const lastNewline = content.lastIndexOf("\n");
  if (lastNewline > 0) content = content.substring(0, lastNewline);
  return { content, truncated: true };
}

/**
 * Resolve a user-supplied path against the agent's working directory.
 */
export function resolvePath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}
