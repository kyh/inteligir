import type { ThreadTimeline, TimelineRow, TimelineRowBase } from "@repo/api/local/thread-timeline";
import { describe, expect, it } from "vitest";
import { formatThreadTimeline } from "../format-thread-timeline";

let nextSeq = 1;

const base = (): TimelineRowBase => {
  const seq = nextSeq;
  nextSeq += 1;
  return {
    createdAt: 1000 + seq,
    id: `row:${seq}`,
    sourceSeqEnd: seq,
    sourceSeqStart: seq,
    threadId: "thr_1",
    turnId: null,
  };
};

const timeline = (rows: TimelineRow[]): ThreadTimeline => ({
  maxSequence: nextSeq,
  rows,
  tokenUsage: null,
});

describe("formatThreadTimeline", () => {
  it("renders a whole conversation with a grouped turn, deterministically", () => {
    const rows: TimelineRow[] = [
      { ...base(), kind: "conversation", role: "user", text: "Write me a note", viewContext: null },
      {
        ...base(),
        children: [
          { ...base(), kind: "work", status: "completed", text: "Plan it", workKind: "reasoning" },
          {
            ...base(),
            approvalStatus: null,
            command: "ls vault",
            cwd: "/vault",
            exitCode: 0,
            kind: "work",
            output: "a.md",
            status: "completed",
            workKind: "command",
          },
          {
            ...base(),
            approvalStatus: null,
            changes: [{ diff: null, kind: "add", movePath: null, path: "notes/a.md" }],
            kind: "work",
            status: "completed",
            workKind: "file-change",
          },
        ],
        completedAt: 2000,
        kind: "turn",
        status: "completed",
        turnId: "turn_1",
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
        children: [
          {
            ...base(),
            error: "index unavailable",
            kind: "work",
            result: null,
            status: "error",
            toolArgs: null,
            toolName: "search_vault",
            workKind: "tool",
          },
          { ...base(), detail: "boom", kind: "error", message: "provider failed" },
        ],
        completedAt: null,
        kind: "turn",
        status: "error",
        turnId: "turn_2",
      },
    ];
    const formatted = formatThreadTimeline({
      maxSequence: nextSeq,
      rows,
      tokenUsage: {
        last: {
          cachedInputTokens: 0,
          inputTokens: 20,
          outputTokens: 10,
          reasoningOutputTokens: 0,
          totalTokens: 30,
        },
        modelContextWindow: null,
        total: {
          cachedInputTokens: 0,
          inputTokens: 20,
          outputTokens: 10,
          reasoningOutputTokens: 0,
          totalTokens: 30,
        },
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
        children: [
          { ...base(), kind: "work", status: "pending", text: "", workKind: "reasoning" },
          {
            ...base(),
            kind: "work",
            status: "pending",
            text: `${longLine}\nmore`,
            workKind: "plan",
          },
        ],
        completedAt: null,
        kind: "turn",
        status: "pending",
        turnId: "turn_3",
      },
    ];
    const formatted = formatThreadTimeline(timeline(rows));
    expect(formatted).toContain(`plan: ${"x".repeat(100)}…`);
    expect(formatted).not.toContain("thinking:");
    expect(formatted.split("\n")[0]).toBe("── turn (pending) ──");
  });
});
