import type {
  ThreadTimeline,
  TimelineRow,
  TimelineRowBase,
} from "@repo/server-contract/thread-timeline";
import { describe, expect, it } from "vitest";
import { formatThreadTimeline } from "../format-thread-timeline";

let nextSeq = 1;

function base(): TimelineRowBase {
  const seq = nextSeq;
  nextSeq += 1;
  return {
    id: `row:${seq}`,
    threadId: "thr_1",
    turnId: null,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    createdAt: 1_000 + seq,
  };
}

function timeline(rows: TimelineRow[]): ThreadTimeline {
  return { rows, maxSequence: nextSeq, tokenUsage: null };
}

describe("formatThreadTimeline", () => {
  it("renders a whole conversation with a grouped turn, deterministically", () => {
    const rows: TimelineRow[] = [
      { ...base(), kind: "conversation", role: "user", text: "Write me a note", viewContext: null },
      {
        ...base(),
        kind: "turn",
        turnId: "turn_1",
        status: "completed",
        completedAt: 2_000,
        children: [
          { ...base(), kind: "work", workKind: "reasoning", status: "completed", text: "Plan it" },
          {
            ...base(),
            kind: "work",
            workKind: "command",
            status: "completed",
            command: "ls vault",
            cwd: "/vault",
            output: "a.md",
            exitCode: 0,
            approvalStatus: null,
          },
          {
            ...base(),
            kind: "work",
            workKind: "file-change",
            status: "completed",
            changes: [{ path: "notes/a.md", kind: "add", movePath: null, diff: null }],
            approvalStatus: null,
          },
        ],
      },
      {
        ...base(),
        kind: "conversation",
        role: "assistant",
        text: "Done — see notes/a.md",
        viewContext: null,
      },
    ];
    expect(formatThreadTimeline(timeline(rows))).toBe(
      [
        "── user ──",
        "Write me a note",
        "",
        "── turn (completed) ──",
        "  thinking: Plan it",
        "  $ ls vault (exit 0)",
        "  ~ add notes/a.md",
        "",
        "── agent ──",
        "Done — see notes/a.md",
      ].join("\n"),
    );
  });

  it("marks non-completed statuses, errors, tools and token usage", () => {
    const rows: TimelineRow[] = [
      {
        ...base(),
        kind: "turn",
        turnId: "turn_2",
        status: "error",
        completedAt: null,
        children: [
          {
            ...base(),
            kind: "work",
            workKind: "tool",
            status: "error",
            toolName: "search_vault",
            toolArgs: null,
            result: null,
            error: "index unavailable",
          },
          { ...base(), kind: "error", message: "provider failed", detail: "boom" },
        ],
      },
    ];
    const formatted = formatThreadTimeline({
      rows,
      maxSequence: nextSeq,
      tokenUsage: {
        total: {
          totalTokens: 30,
          inputTokens: 20,
          cachedInputTokens: 0,
          outputTokens: 10,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 30,
          inputTokens: 20,
          cachedInputTokens: 0,
          outputTokens: 10,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: null,
      },
    });
    expect(formatted).toBe(
      [
        "── turn (error) ──",
        "  tool search_vault [error] — index unavailable",
        "  ── error ──",
        "  provider failed",
        "  boom",
        "",
        "tokens: 30 total (20 in, 10 out)",
      ].join("\n"),
    );
  });

  it("truncates long first lines and skips empty reasoning", () => {
    const longLine = "x".repeat(150);
    const rows: TimelineRow[] = [
      {
        ...base(),
        kind: "turn",
        turnId: "turn_3",
        status: "pending",
        completedAt: null,
        children: [
          { ...base(), kind: "work", workKind: "reasoning", status: "pending", text: "" },
          {
            ...base(),
            kind: "work",
            workKind: "plan",
            status: "pending",
            text: `${longLine}\nmore`,
          },
        ],
      },
    ];
    const formatted = formatThreadTimeline(timeline(rows));
    expect(formatted).toContain(`plan: ${"x".repeat(100)}…`);
    expect(formatted).not.toContain("thinking:");
    expect(formatted.split("\n")[0]).toBe("── turn (pending) ──");
  });
});
