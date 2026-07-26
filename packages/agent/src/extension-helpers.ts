/**
 * Shared formatters for PiExtensionBundle tool results. Each CLI-backed bundle
 * (peekaboo, browser) returns the same content-block shape; centralizing
 * the construction keeps the bundles focused on tool-specific concerns.
 */

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateTail,
} from "@repo/agent/pi/pi-types";

export type ToolTextResult = {
  content: [{ type: "text"; text: string }];
  details: Record<string, never>;
};

export function textResult(value: string): ToolTextResult {
  return { content: [{ type: "text", text: value }], details: {} };
}

/** pi's documented per-tool output ceiling (docs/extensions.md § Output
 * Truncation): 50KB / 2000 lines, whichever is hit first. Re-exported as a
 * human string so each tool's `description` can state its own limit without
 * hardcoding the numbers twice. */
export const TOOL_OUTPUT_LIMIT_TEXT = `${formatSize(DEFAULT_MAX_BYTES)} / ${DEFAULT_MAX_LINES} lines`;

/**
 * A text result bounded to pi's tool-output limit.
 *
 * pi does NOT truncate custom tool results centrally — its rule is that each
 * tool truncates its own output, because a single oversized result overflows
 * the context and then poisons the transcript for every later turn (the entry
 * stays in history until the thread is rolled). Our three unbounded producers
 * are the CLI proxies (peekaboo accessibility trees, agent-browser snapshots)
 * and code-mode `execute`, whose `maxBuffer` caps only kill the child on
 * overflow — they never shorten what we hand back.
 *
 * `keep` picks which end survives: "head" for content whose beginning carries
 * the structure (accessibility trees, execution results), "tail" for command
 * output where the end carries the outcome (errors, final lines).
 *
 * NO on-disk dump. pi's example writes the full output to a temp file and
 * points the model at it; we deliberately don't, for two reasons:
 *  1. Privacy. A peekaboo tree or browser snapshot can contain the body of a
 *     `private: true` note that happens to be on screen. The privacy gate is
 *     a live-disk probe on vault paths — it cannot reach note content that
 *     has already been screen-scraped into a dump file, and nothing prunes
 *     such a file afterward. Truncating is the only option that keeps the
 *     blast radius inside the turn.
 *  2. Staleness. These outputs are snapshots of live UI state; a file written
 *     one turn ago describes a window that has since changed. Re-running with
 *     a narrower command is the correct recovery, not reading a stale dump —
 *     so the footer says that instead of naming a path.
 */
export function truncatedText(value: string, keep: "head" | "tail"): string {
  const truncation = keep === "head" ? truncateHead(value) : truncateTail(value);
  if (!truncation.truncated) return truncation.content;
  const kept = keep === "head" ? "first" : "last";
  return (
    `${truncation.content}\n\n[Output truncated: ${kept} ${truncation.outputLines} of ` +
    `${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ` +
    `${formatSize(truncation.totalBytes)}). The full output is NOT saved anywhere — ` +
    `re-run with a narrower scope (a more specific target, a filter, or a smaller ` +
    `range) to see the rest.]`
  );
}

/** `truncatedText` in the standard single-text-block result shape. The string
 * form exists for the one tool (browser) that appends an image block and has
 * to assemble `content` itself. */
export function truncatedTextResult(value: string, keep: "head" | "tail"): ToolTextResult {
  return textResult(truncatedText(value, keep));
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
