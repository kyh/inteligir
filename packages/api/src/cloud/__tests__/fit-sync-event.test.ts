import { threadEventSchema } from "@repo/domain/provider-event";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { utf8ByteLength } from "../bytes";
import { clipThreadEventForSync } from "../sync/fit-sync-event";
import { EVENT_MAX_BYTES, syncEventInputSchema } from "../sync/sync-schema";

const THREAD_ID = "thr_clip";
const scope = turnScope("turn_1");
const big = (size: number): string => "x".repeat(size);

const bodyBytes = (event: ThreadEvent): number => utf8ByteLength(JSON.stringify(event));

// every type that carries payload text, each over a 4KB cap on its own.
const overCap = {
  "a command's output": {
    item: {
      aggregatedOutput: big(10_000),
      approvalStatus: null,
      command: "cat big.log",
      cwd: "/vault",
      exitCode: 0,
      id: "item_c",
      status: "completed",
      type: "commandExecution",
    },
    scope,
    threadId: THREAD_ID,
    type: "item/completed",
  },
  "a file change's diffs": {
    item: {
      approvalStatus: null,
      changes: [
        { diff: big(6000), kind: "update", path: "a.md" },
        { kind: "add", path: "b.md" },
        { diff: big(3000), kind: "update", path: "c.md" },
      ],
      id: "item_f",
      status: "completed",
      type: "fileChange",
    },
    scope,
    threadId: THREAD_ID,
    type: "item/completed",
  },
  "a message's text": {
    item: { id: "item_a", text: big(10_000), type: "agentMessage" },
    scope,
    threadId: THREAD_ID,
    type: "item/completed",
  },
  "a plan's text": {
    item: { id: "item_p", text: big(10_000), type: "plan" },
    scope,
    threadId: THREAD_ID,
    type: "item/started",
  },
  "a provider error": {
    detail: big(8000),
    message: big(3000),
    scope: threadScope(),
    threadId: THREAD_ID,
    type: "provider/error",
  },
  "a reasoning's parts": {
    item: {
      content: [big(3000), big(3000), big(3000)],
      id: "item_r",
      summary: [big(2000)],
      type: "reasoning",
    },
    scope,
    threadId: THREAD_ID,
    type: "item/completed",
  },
  "a streamed delta": {
    delta: big(10_000),
    itemId: "item_c",
    reset: true,
    scope,
    threadId: THREAD_ID,
    type: "item/commandExecution/outputDelta",
  },
  "a tool call's arguments and structured result": {
    item: {
      arguments: { content: big(5000), path: "notes/a.md", retries: 3 },
      id: "item_t",
      result: { lines: Array.from({ length: 800 }, (_, index) => `line ${index}`) },
      status: "completed",
      tool: "Write",
      type: "toolCall",
    },
    scope,
    threadId: THREAD_ID,
    type: "item/completed",
  },
  "a turn's failure": {
    error: { message: big(10_000) },
    scope,
    status: "failed",
    threadId: THREAD_ID,
    type: "turn/completed",
  },
  "a user's message": {
    scope: threadScope(),
    text: big(10_000),
    threadId: THREAD_ID,
    type: "client/turn/requested",
  },
} satisfies Record<string, ThreadEvent>;

const PAYLOAD_KEYS = new Set([
  "aggregatedOutput",
  "arguments",
  "content",
  "delta",
  "detail",
  "diff",
  "message",
  "result",
  "summary",
  "text",
]);

// what a peer's fold reads besides the payload text: the clip must leave all of it alone.
const envelopeOf = (event: ThreadEvent): string =>
  JSON.stringify(event, (key, value) => (PAYLOAD_KEYS.has(key) ? "<payload>" : value));

describe("clipThreadEventForSync", () => {
  it("hands back an event that already fits untouched", () => {
    const event: ThreadEvent = {
      scope: threadScope(),
      text: "hello",
      threadId: THREAD_ID,
      type: "client/turn/requested",
    };
    expect(clipThreadEventForSync(event, EVENT_MAX_BYTES)).toBe(event);
  });

  for (const [name, event] of Object.entries(overCap)) {
    it(`fits ${name} under the cap, keeping every type, id, status and scope`, () => {
      const before = JSON.stringify(event);
      const clipped = clipThreadEventForSync(event, 4096);
      expect(bodyBytes(clipped)).toBeLessThanOrEqual(4096);
      expect(threadEventSchema.parse(clipped)).toEqual(clipped);
      expect(envelopeOf(clipped)).toBe(envelopeOf(event));
      expect(JSON.stringify(clipped)).toContain("bytes elided …]");
      // the local row is the caller's event: the clip works on its own copy.
      expect(JSON.stringify(event)).toBe(before);
    });
  }

  it("cuts a 200KB command output to a body the push contract takes, head and tail kept", () => {
    const output = `$ make\n${"compiling…\n".repeat(20_000)}error: the last line\n`;
    const event: ThreadEvent = {
      item: {
        aggregatedOutput: output,
        approvalStatus: null,
        command: "make",
        cwd: "/vault",
        exitCode: 2,
        id: "item_c",
        status: "failed",
        type: "commandExecution",
      },
      scope,
      threadId: THREAD_ID,
      type: "item/completed",
    };
    expect(utf8ByteLength(output)).toBeGreaterThan(200_000);

    const clipped = clipThreadEventForSync(event, EVENT_MAX_BYTES);
    const parsed = syncEventInputSchema.safeParse({
      createdAt: 1,
      deviceSeq: 1,
      event: clipped,
      threadId: THREAD_ID,
    });
    expect(parsed.success).toBe(true);
    // only what the cap demands goes: the body lands within a marker's width of it.
    expect(bodyBytes(clipped)).toBeGreaterThan(EVENT_MAX_BYTES - 64);

    if (clipped.type !== "item/completed" || clipped.item.type !== "commandExecution") {
      throw new Error("the clip changed the event's type");
    }
    const kept = clipped.item.aggregatedOutput ?? "";
    expect(kept.startsWith("$ make\ncompiling…")).toBe(true);
    expect(kept.endsWith("error: the last line\n")).toBe(true);
    const elided = /\[… (?<bytes>\d+) bytes elided …\]/u.exec(kept)?.groups?.bytes;
    const marker = `[… ${elided} bytes elided …]`;
    expect(Number(elided)).toBe(utf8ByteLength(output) - utf8ByteLength(kept.replace(marker, "")));
  });

  it("measures what the json spells: escapes and multi-byte text never push it over, nor split a pair", () => {
    const event: ThreadEvent = {
      delta: `${"😀あ".repeat(1500)}${'"quoted"\n\t'.repeat(1500)}${"\u0001".repeat(300)}${"あ😀".repeat(1500)}`,
      itemId: "item_a",
      scope,
      threadId: THREAD_ID,
      type: "item/agentMessage/delta",
    };
    // a sweep of caps lands the head's and the tail's cut on every kind of character.
    for (let maxBytes = 1000; maxBytes < 45_000; maxBytes += 997) {
      const clipped = clipThreadEventForSync(event, maxBytes);
      expect(bodyBytes(clipped)).toBeLessThanOrEqual(maxBytes);
      expect(JSON.stringify(clipped)).not.toMatch(/\\ud[89a-f]/u);
    }
  });

  it("hands back an event whose envelope alone is over the cap still over it, for the outbox to refuse", () => {
    const event: ThreadEvent = {
      item: {
        approvalStatus: null,
        changes: Array.from({ length: 200 }, (_, index) => ({
          kind: "add",
          path: `notes/${index}.md`,
        })),
        id: "item_f",
        status: "completed",
        type: "fileChange",
      },
      scope,
      threadId: THREAD_ID,
      type: "item/completed",
    };
    expect(bodyBytes(clipThreadEventForSync(event, 1024))).toBeGreaterThan(1024);
  });
});
