// What the pinned adapters really sent (scripts/record-acp-transcripts.ts), replayed through the sdk's
// own client, whose schema parse is the runtime's boundary too, then through AcpTurnMapper. A pin
// bump re-records these, and a diff here is the adapter's wire moving under the mapper.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { client, ndJsonStream } from "@agentclientprotocol/sdk";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ProviderEvent } from "../../vocabulary/provider-event";
import { AcpTurnMapper } from "../acp-event-mapping";
import { toApprovalPayload, toPermissionOutcome } from "../acp-permission-mapping";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const CTX = { providerThreadId: "session_recorded", threadId: "thr_replay", turnId: "turn_replay" };

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
    sessionId: CTX.providerThreadId,
  });
  const writer = fromAgent.writable.getWriter();
  const encoder = new TextEncoder();
  for (const line of lines) {
    const response = promptResponseSchema.safeParse(JSON.parse(line));
    // the recorded response answers the recording's request id; the prompt is this client's first.
    const frame = response.success ? JSON.stringify({ ...response.data, id: 0 }) : line;
    await writer.write(encoder.encode(`${frame}\n`));
  }
  const { stopReason } = await prompt;
  replayed.events.push(...mapper.completed(stopReason));
  connection.close();
  return replayed;
};

type WithoutEnvelope<Event> = Event extends ProviderEvent
  ? Omit<Event, "providerThreadId" | "scope" | "threadId">
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
    const { providerThreadId: _thread, scope: _scope, threadId: _id, ...rest } = event;
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

describe.each(adapters)("%s", (adapter) => {
  const read = (scenario: string): string[] =>
    readFileSync(path.join(FIXTURES, adapter, `${scenario}.ndjson`), "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "");

  const scenarios = readdirSync(path.join(FIXTURES, adapter)).map((file) =>
    path.basename(file, ".ndjson"),
  );

  it.each(scenarios)("replays %s onto the provider grammar", async (scenario) => {
    const { approvals, events } = await replay(read(scenario));

    for (const event of events) {
      expect(event).toMatchObject({
        providerThreadId: CTX.providerThreadId,
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
