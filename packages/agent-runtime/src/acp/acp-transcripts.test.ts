// What the pinned adapters really sent (scripts/record-acp-transcripts.ts), replayed through the sdk's
// own client, whose schema parse is the runtime's boundary too, then through AcpTurnMapper. A pin
// bump re-records these, and a diff here is the adapter's wire moving under the mapper.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { client, ndJsonStream } from "@agentclientprotocol/sdk";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ProviderEvent } from "../vocabulary/provider-event";
import { AcpTurnMapper } from "./acp-event-mapping";
import { toApprovalPayload, toPermissionOutcome } from "./acp-permission-mapping";
import { readSessionFailure } from "./provider-error";

const FIXTURES = path.join(import.meta.dirname, "test-support", "fixtures");
const SESSION_ID = "session_recorded";
const CTX = { threadId: "thr_replay", turnId: "turn_replay" };

const promptResponseSchema = z.looseObject({
  id: z.union([z.number(), z.string()]),
  result: z.looseObject({ stopReason: z.string() }),
});

const toolFrameSchema = z.object({
  params: z.object({
    update: z.object({
      sessionUpdate: z.enum(["tool_call", "tool_call_update"]),
      toolCallId: z.string(),
    }),
  }),
});

interface Replayed {
  events: ProviderEvent[];
  approvals: ApprovalPendingInteractionPayload[];
}

const replay = async (lines: readonly string[]): Promise<Replayed> => {
  const mapper = new AcpTurnMapper(CTX);
  const replayed: Replayed = { approvals: [], events: mapper.started() };
  const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
  const connection = client({ name: "replay" })
    .onRequest("session/request_permission", ({ params }) => {
      replayed.approvals.push(toApprovalPayload(params));
      return { outcome: toPermissionOutcome(params, { decision: "allow_once" }) };
    })
    .onNotification("session/update", ({ params }) => {
      replayed.events.push(...mapper.update(params));
    })
    .connect(ndJsonStream(new WritableStream<Uint8Array>(), fromAgent.readable));
  const prompt = connection.agent.request("session/prompt", {
    prompt: [],
    sessionId: SESSION_ID,
  });
  const writer = fromAgent.writable.getWriter();
  const encoder = new TextEncoder();
  for (const line of lines) {
    const response = promptResponseSchema.safeParse(JSON.parse(line));
    // the recorded response answers the recording's request id; the prompt is this client's first.
    const frame = response.success ? JSON.stringify({ ...response.data, id: 0 }) : line;
    await writer.write(encoder.encode(`${frame}\n`));
  }
  // as the runtime settles a prompt's answer: a typed failure fails the turn whatever its stop.
  const { _meta: meta, stopReason } = await prompt;
  const failure = readSessionFailure(meta);
  replayed.events.push(
    ...(failure === null
      ? mapper.completed(stopReason)
      : mapper.failed(failure.adapterMessage, failure.failure)),
  );
  connection.close();
  return replayed;
};

type WithoutEnvelope<Event> = Event extends ProviderEvent
  ? Omit<Event, "scope" | "threadId">
  : never;

interface DeltaRun {
  type: string;
  itemId: string;
  delta: string;
  deltas: number;
}

// the envelope is the mapper's context on every event and is asserted once; consecutive deltas of
// one item fold into one row, since chunk boundaries are the model's, not the mapper's.
const compact = (
  events: readonly ProviderEvent[],
): (WithoutEnvelope<ProviderEvent> | DeltaRun)[] => {
  const rows: (WithoutEnvelope<ProviderEvent> | DeltaRun)[] = [];
  for (const event of events) {
    const { scope: _scope, threadId: _id, ...rest } = event;
    if (event.type === "item/agentMessage/delta" || event.type === "item/reasoning/textDelta") {
      const last = rows.at(-1);
      if (
        last !== undefined &&
        "deltas" in last &&
        last.type === event.type &&
        last.itemId === event.itemId
      ) {
        last.delta += event.delta;
        last.deltas += 1;
      } else {
        rows.push({ delta: event.delta, deltas: 1, itemId: event.itemId, type: event.type });
      }
      continue;
    }
    rows.push(rest);
  }
  return rows;
};

const fileChanges = (events: readonly ProviderEvent[]) =>
  events.flatMap((event) =>
    event.type === "item/completed" && event.item.type === "fileChange" ? event.item.changes : [],
  );

const commands = (events: readonly ProviderEvent[]) =>
  events.flatMap((event) =>
    event.type === "item/completed" && event.item.type === "commandExecution"
      ? [{ output: event.item.aggregatedOutput, status: event.item.status }]
      : [],
  );

const messages = (events: readonly ProviderEvent[]) =>
  events.flatMap((event) =>
    event.type === "item/completed" && event.item.type === "agentMessage" ? [event.item.text] : [],
  );

const adapters = readdirSync(FIXTURES);

const readFixture = (adapter: string, scenario: string): string[] =>
  readFileSync(path.join(FIXTURES, adapter, `${scenario}.ndjson`), "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "");

describe.each(adapters)("%s", (adapter) => {
  const read = (scenario: string): string[] => readFixture(adapter, scenario);

  const scenarios = readdirSync(path.join(FIXTURES, adapter)).map((file) =>
    path.basename(file, ".ndjson"),
  );

  it.each(scenarios)("replays %s onto the provider grammar", async (scenario) => {
    const { approvals, events } = await replay(read(scenario));

    for (const event of events) {
      expect(event).toMatchObject({
        scope: { kind: "turn", turnId: CTX.turnId },
        threadId: CTX.threadId,
      });
    }
    expect(events.filter((event) => event.type === "turn/completed")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("turn/completed");
    const started = events.flatMap((event) =>
      event.type === "item/started" ? [event.item.id] : [],
    );
    const completed = events.flatMap((event) =>
      event.type === "item/completed" ? [event.item.id] : [],
    );
    expect(completed.toSorted()).toEqual(started.toSorted());
    expect({ approvals, events: compact(events) }).toMatchSnapshot();
  });

  it("never updates a tool call it did not announce, so the mapper's drop never fires", () => {
    for (const scenario of scenarios) {
      const announced = new Set<string>();
      for (const line of read(scenario)) {
        const frame = toolFrameSchema.safeParse(JSON.parse(line));
        if (!frame.success) {
          continue;
        }
        const { sessionUpdate, toolCallId } = frame.data.params.update;
        if (sessionUpdate === "tool_call") {
          announced.add(toolCallId);
        } else {
          expect(announced, `${scenario}: ${toolCallId}`).toContain(toolCallId);
        }
      }
    }
  });

  it("names both written files in the turn's write set, the new one as an add", async () => {
    const { events } = await replay(read("edit"));
    expect(new Map(fileChanges(events).map((change) => [change.path, change.kind]))).toEqual(
      new Map([
        ["/vault/hello.md", "add"],
        ["/vault/note.md", "update"],
      ]),
    );
  });

  it("carries the command's output on its command item", async () => {
    const { events } = await replay(read("command"));
    expect(commands(events)).toEqual([
      { output: expect.stringMatching(/a\.md\s+b\.md/u), status: "completed" },
    ]);
  });

  it("completes the failed command's item as failed, carrying what it printed", async () => {
    const { events } = await replay(read("failed-command"));
    expect(commands(events)).toContainEqual({
      output: expect.stringContaining("missing-file.md"),
      status: "failed",
    });
  });

  it.each(scenarios)("keeps the adapter's own warnings out of the %s message", async (scenario) => {
    const { events } = await replay(read(scenario));
    for (const text of messages(events)) {
      expect(text).not.toMatch(/^Warning: /mu);
    }
  });
});

describe("a turn codex ended on a typed failure", () => {
  it("fails a context overflow as context, never speaking the error as the agent", async () => {
    const codex = adapters.find((adapter) => adapter.startsWith("codex-acp@"));
    if (codex === undefined) {
      throw new Error("no codex-acp recording under fixtures/");
    }
    const { events } = await replay(readFixture(codex, "context-overflow"));
    expect(events.filter((event) => event.type === "provider/error")).toEqual([
      expect.objectContaining({
        failure: "context",
        message: expect.stringContaining("context window"),
      }),
    ]);
    expect(events.at(-1)).toMatchObject({ status: "failed", type: "turn/completed" });
    expect(events.some((event) => event.type === "item/agentMessage/delta")).toBe(false);
    expect(messages(events)).toEqual([]);
  });
});
