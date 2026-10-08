import { partialMatchKey, QueryClient } from "@tanstack/react-query";
import type { ChangedMessage, ThreadChangedMessage } from "@repo/contract/local/notifications";
import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import { THREAD_CHANGE_KINDS, SYNC_CHANGE_KINDS } from "@repo/domain/change-kinds";
import { describe, expect, it, vi } from "vitest";
import { orpc } from "../api";
import { ChangeBatch, sweepAfterReconnect } from "../workspace-context";

interface Applied {
  invalidated: readonly unknown[][];
  threads: ThreadChangedMessage[];
}

type Sweep = Parameters<typeof sweepAfterReconnect>;

const record = (run: (...args: Sweep) => void): Applied => {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  const threads: ThreadChangedMessage[] = [];
  run(queryClient, (message) => {
    threads.push(message);
  });
  const invalidated = invalidateQueries.mock.calls.map(([filters]) => [
    ...(filters?.queryKey ?? []),
  ]);
  return { invalidated, threads };
};

const applyBatch = (messages: readonly ChangedMessage[]): Applied =>
  record((...args) => {
    const batch = new ChangeBatch();
    for (const message of messages) {
      batch.add(message);
    }
    batch.apply(...args);
  });

const apply = (...messages: ChangedMessage[]): Applied => applyBatch(messages);

const detailKey = (threadId: string): unknown[] => [
  ...orpc.threads.get.key({ input: { threadId } }),
];

const threadChanged = (id: string, changes: readonly ThreadChangeKind[]): ChangedMessage => ({
  changes,
  entity: "thread",
  id,
  type: "changed",
});

describe("a sync change", () => {
  it("sweeps the account's sync status on its own kind", () => {
    const applied = apply({
      changes: ["sync-status-changed"],
      entity: "sync",
      type: "changed",
    });

    expect(applied.invalidated).toEqual([[...orpc.cloud.status.key()]]);
  });
});

describe("a burst of frames in one flush", () => {
  it("forwards one message per thread with every kind its frames carried", () => {
    const applied = apply(
      threadChanged("t1", ["events-appended"]),
      threadChanged("t2", ["queue-changed"]),
      threadChanged("t1", ["events-appended"]),
      threadChanged("t1", ["status-changed"]),
    );

    expect(applied.threads).toEqual([
      threadChanged("t1", ["events-appended", "status-changed"]),
      threadChanged("t2", ["queue-changed"]),
    ]);
  });
});

describe("a thread change", () => {
  const listKey = [...orpc.threads.list.key()];
  const MOVES_LIST_AND_DETAIL: readonly ThreadChangeKind[] = [
    "thread-created",
    "status-changed",
    "archived-changed",
    "title-changed",
  ];
  const MOVES_DETAIL_ALONE: readonly ThreadChangeKind[] = ["queue-changed", "interactions-changed"];
  const MOVES_NEITHER: readonly ThreadChangeKind[] = ["events-appended"];

  it("weighs every kind in the vocabulary here too", () => {
    expect([...MOVES_LIST_AND_DETAIL, ...MOVES_DETAIL_ALONE, ...MOVES_NEITHER].toSorted()).toEqual(
      [...THREAD_CHANGE_KINDS].toSorted(),
    );
  });

  it.each(MOVES_LIST_AND_DETAIL)("%s moves the list row and the thread's detail", (kind) => {
    const applied = apply(threadChanged("t1", [kind]));

    expect(applied.invalidated).toEqual([listKey, detailKey("t1")]);
  });

  it.each(MOVES_DETAIL_ALONE)("%s moves the thread's detail alone", (kind) => {
    const applied = apply(threadChanged("t1", [kind]));

    expect(applied.invalidated).toEqual([detailKey("t1")]);
  });

  it("refetches nothing for a streamed turn: the timeline's delta fetch is the only reader", () => {
    const frames = Array.from({ length: 100 }, () => threadChanged("t1", MOVES_NEITHER));
    const applied = applyBatch(frames);

    expect(applied.invalidated).toEqual([]);
    expect(applied.threads).toEqual([threadChanged("t1", MOVES_NEITHER)]);
  });

  it("refetches the list once for many threads, and each moved detail by its own id", () => {
    const applied = apply(
      threadChanged("t1", ["status-changed"]),
      threadChanged("t2", ["archived-changed"]),
    );

    expect(applied.invalidated).toEqual([listKey, detailKey("t1"), detailKey("t2")]);
  });

  it("refetches every detail when a frame names no thread", () => {
    const applied = apply({ changes: ["interactions-changed"], entity: "thread", type: "changed" });

    expect(applied.invalidated).toEqual([[...orpc.threads.get.key()]]);
    expect(applied.threads).toEqual([
      { changes: ["interactions-changed"], entity: "thread", type: "changed" },
    ]);
  });
});

describe("a reconnect", () => {
  it("covers every query a frame can invalidate, since a gap in the socket produced none", () => {
    const everyFrame = [
      apply({ changes: SYNC_CHANGE_KINDS, entity: "sync", type: "changed" }),
      apply(threadChanged("t1", THREAD_CHANGE_KINDS)),
      apply({ changes: THREAD_CHANGE_KINDS, entity: "thread", type: "changed" }),
    ].flatMap((applied) => applied.invalidated);
    const swept = record(sweepAfterReconnect).invalidated;

    const uncovered = everyFrame.filter(
      (frameKey) => !swept.some((sweptKey) => partialMatchKey(frameKey, sweptKey)),
    );
    expect(uncovered).toEqual([]);
    expect(swept).toContainEqual([...orpc.cloud.status.key()]);
  });

  it("tells every thread to re-check", () => {
    const { threads } = record(sweepAfterReconnect);

    expect(threads).toEqual([{ changes: THREAD_CHANGE_KINDS, entity: "thread", type: "changed" }]);
  });
});
