import { on } from "node:events";
import { createORPCClient, DynamicLink } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AgentEvent } from "@repo/contract/library/agent-events";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

import { threadStream } from "./thread-stream";

const THREAD = "0199a4c2-0000-7000-8000-0000000000e1";

interface Asked {
  readonly lastEventId: string | undefined;
  readonly signal: AbortSignal | undefined;
}

// a device over a cloud that answers a thread's events from `events`, by the last id the device
// held, and counts each time the device asks what moved in the library
const device = (events: (asked: Asked) => AsyncIterable<object>) => {
  const asked: Asked[] = [];
  let changesAsked = 0;
  const client = createORPCClient<V1Client>(
    new DynamicLink((options, path) => ({
      call: async () => {
        if (path.join(".") === "library.changes") {
          changesAsked += 1;
          return await Promise.resolve({ head: changesAsked, moved: null });
        }
        const call = { lastEventId: options.lastEventId, signal: options.signal };
        asked.push(call);
        return events(call);
      },
    })),
  );
  const orpc = createTanstackQueryUtils(client);
  return {
    asked,
    changesAsked: () => changesAsked,
    follow: threadStream({ client, orpc }),
    orpc,
    queryClient: new QueryClient(),
  };
};

const row = (line: number, event: AgentEvent) => ({
  at: line,
  event,
  eventId: `1:${String(line)}:0`,
  threadId: THREAD,
  type: event.type,
});

const replyAt = (line: number) =>
  row(line, { text: `Reply ${String(line)}`, type: "agent.message" });

const sentSchema = z.object({ detail: z.object({}).loose() });

// events a suite hands the stream one at a time, held from the moment it opens until it is read,
// and ended as its follower aborts
const feed = (signal: AbortSignal | undefined) => {
  const sent = new EventTarget();
  const held = on(sent, "event", { signal });
  const events = async function* events() {
    for await (const [event] of held) {
      yield sentSchema.parse(event).detail;
    }
  };
  return {
    events: events(),
    send: (...next: object[]) => {
      for (const event of next) {
        sent.dispatchEvent(new CustomEvent("event", { detail: event }));
      }
    },
  };
};

describe("a conversation followed as it happens", () => {
  it("streams its events then the reply's draft, and picks up after the last one held", async () => {
    const stored = [replyAt(1), replyAt(2)];
    const { asked, follow, queryClient } = device(async function* events({ lastEventId }) {
      const after = stored.findIndex(({ eventId }) => eventId === lastEventId);
      for (const kept of stored.slice(after + 1)) {
        yield { kind: "event", row: kept };
      }
      yield { kind: "caughtUp" };
      if (lastEventId === undefined) {
        yield { kind: "draft", text: "Wri" };
        yield { kind: "draft", text: "ting" };
      }
    });
    const first = await queryClient.query(follow(THREAD));
    expect(first.rows.map(({ eventId }) => eventId)).toStrictEqual(["1:1:0", "1:2:0"]);
    expect(first.draft).toBe("Writing");

    stored.push(replyAt(3));
    const resumed = await queryClient.query(follow(THREAD));
    expect(resumed.rows.map(({ eventId }) => eventId)).toStrictEqual(["1:1:0", "1:2:0", "1:3:0"]);
    expect(resumed.draft).toBe("");
    expect(asked.map(({ lastEventId }) => lastEventId)).toStrictEqual([undefined, "1:2:0"]);
  });

  it("aborts its stream once nothing shows the thread, keeping what it read", async () => {
    const feeds: ReturnType<typeof feed>[] = [];
    const { asked, follow, queryClient } = device(({ signal }) => {
      const opened = feed(signal);
      feeds.push(opened);
      opened.send({ kind: "event", row: replyAt(1) }, { kind: "caughtUp" });
      return opened.events;
    });
    const shown = new QueryObserver(queryClient, follow(THREAD));
    const stop = shown.subscribe(() => {
      // a screen draws what it holds
    });
    await vi.waitFor(() => {
      expect(shown.getCurrentResult().data?.rows).toHaveLength(1);
    });
    feeds[0]?.send({ kind: "draft", text: "Half a rep" });
    await vi.waitFor(() => {
      expect(shown.getCurrentResult().data?.draft).toBe("Half a rep");
    });

    stop();
    expect(asked[0]?.signal?.aborted).toBe(true);
    expect(queryClient.getQueryData(follow(THREAD).queryKey)).toMatchObject({
      rows: [{ eventId: "1:1:0" }],
    });
  });

  it("asks again what a live event moved: the thread's place and its Undo, and the library", async () => {
    const feeds: ReturnType<typeof feed>[] = [];
    const { changesAsked, follow, orpc, queryClient } = device(({ signal }) => {
      const opened = feed(signal);
      feeds.push(opened);
      return opened.events;
    });
    const undoable = orpc.library.agent.undoable.queryKey({ input: { threadId: THREAD } });
    queryClient.setQueryData(undoable, { turns: [] });
    const changes = new QueryObserver(
      queryClient,
      orpc.library.changes.queryOptions({ input: {}, staleTime: Number.POSITIVE_INFINITY }),
    );
    const stopChanges = changes.subscribe(() => {
      // the device's beat over what moved
    });
    const shown = new QueryObserver(queryClient, follow(THREAD));
    const stop = shown.subscribe(() => {
      // a screen draws what it holds
    });
    await vi.waitFor(() => {
      expect(changesAsked()).toBe(1);
      expect(feeds).toHaveLength(1);
    });

    // the history a first read replays moves nothing it did not read fresh
    feeds[0]?.send(
      { kind: "event", row: row(1, { reason: "done", turn: 1, type: "turn.ended" }) },
      { kind: "caughtUp" },
    );
    await vi.waitFor(() => {
      expect(shown.getCurrentResult().data?.rows).toHaveLength(1);
    });
    expect(queryClient.getQueryState(undoable)?.isInvalidated).toBe(false);
    expect(changesAsked()).toBe(1);

    const result = { isError: false, summary: "Wrote it", toolUseId: "t1" };
    feeds[0]?.send({ kind: "event", row: row(2, { ...result, type: "agent.tool_result" }) });
    await vi.waitFor(() => {
      expect(changesAsked()).toBe(2);
    });
    expect(queryClient.getQueryState(undoable)?.isInvalidated).toBe(false);

    feeds[0]?.send({ kind: "event", row: row(3, { reason: "done", turn: 2, type: "turn.ended" }) });
    await vi.waitFor(() => {
      expect(changesAsked()).toBe(3);
    });
    expect(queryClient.getQueryState(undoable)?.isInvalidated).toBe(true);
    stop();
    stopChanges();
  });
});
