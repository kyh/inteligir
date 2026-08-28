// Compact text rendering of a ThreadTimeline for `inteligir action show`.
// Terminal presentation, not a shared read model, so it lives beside its one
// caller rather than in the contract. The shape follows bb's format-timeline-text
// (github.com/get-bb/bb, MIT) trimmed to v1's row grammar. Deliberately
// deterministic: no timestamps, no color — the same timeline always renders
// the same bytes, so CLI output tests can pin it.

import type {
  ThreadTimeline,
  TimelineRow,
  TimelineRowStatus,
  TimelineWorkRow,
} from "@repo/api/local/thread-timeline";

const CHILD_INDENT = "  ";
const SNIPPET_LIMIT = 100;

/** First line of a possibly-multiline text, bounded, with a cut marker. */
function snippet(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (firstLine.length <= SNIPPET_LIMIT) {
    return firstLine;
  }
  return `${firstLine.slice(0, SNIPPET_LIMIT)}…`;
}

function statusSuffix(status: TimelineRowStatus): string {
  return status === "completed" ? "" : ` [${status}]`;
}

function formatWorkRow(row: TimelineWorkRow): string[] {
  switch (row.workKind) {
    case "command": {
      const exit = row.exitCode === null ? "" : ` (exit ${row.exitCode})`;
      return [`$ ${snippet(row.command)}${exit}${statusSuffix(row.status)}`];
    }
    case "tool": {
      const failure = row.error === null ? "" : ` — ${snippet(row.error)}`;
      return [`tool ${row.toolName}${statusSuffix(row.status)}${failure}`];
    }
    case "file-change":
      return row.changes.map((change) => {
        const move = change.movePath === null ? "" : ` -> ${change.movePath}`;
        return `~ ${change.kind} ${change.path}${move}${statusSuffix(row.status)}`;
      });
    case "reasoning":
      return row.text.length === 0 ? [] : [`thinking: ${snippet(row.text)}`];
    case "plan":
      return row.text.length === 0 ? [] : [`plan: ${snippet(row.text)}`];
  }
}

function formatRow(row: TimelineRow): string[] {
  switch (row.kind) {
    case "conversation":
      return [`── ${row.role === "user" ? "user" : "agent"} ──`, row.text];
    case "error":
      return [`── error ──`, row.detail === null ? row.message : `${row.message}\n${row.detail}`];
    case "work":
      // A work row outside a turn (the projection's orphan fallback) keeps
      // the same one-line shape it would have had as a child.
      return formatWorkRow(row);
    case "turn": {
      const children = row.children
        .flatMap((child) => formatRow(child))
        .flatMap((line) => line.split("\n"))
        .map((line) => (line.length === 0 ? line : `${CHILD_INDENT}${line}`));
      return [`── turn (${row.status}) ──`, ...children];
    }
  }
}

export function formatThreadTimeline(timeline: ThreadTimeline): string {
  const blocks = timeline.rows.map((row) => formatRow(row).join("\n"));
  if (timeline.tokenUsage !== null) {
    const { total } = timeline.tokenUsage;
    blocks.push(
      `tokens: ${total.totalTokens} total (${total.inputTokens} in, ${total.outputTokens} out)`,
    );
  }
  return blocks.filter((block) => block.length > 0).join("\n\n");
}
