import { partialMatchKey, QueryClient } from "@tanstack/react-query";
import type { ChangedMessage, ThreadChangedMessage } from "@repo/contract/local/notifications";
import type { VaultTreeResponse } from "@repo/contract/local/vault/vault-schema";
import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import type { VaultChangedEvent } from "@repo/editor/host-io";
import { THREAD_CHANGE_KINDS, VAULT_CHANGE_KINDS } from "@repo/domain/change-kinds";
import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import { describe, expect, it, vi } from "vitest";
import { orpc } from "../api";
import { ChangeBatch, sweepAfterReconnect } from "../change-batch";

interface Applied {
  invalidated: readonly unknown[][];
  vaultChanges: VaultChangedEvent[];
  threads: ThreadChangedMessage[];
  queryClient: QueryClient;
}

type Sweep = Parameters<typeof sweepAfterReconnect>;

const record = (
  run: (...args: Sweep) => void,
  seed: (queryClient: QueryClient) => void = () => {},
): Applied => {
  const queryClient = new QueryClient();
  seed(queryClient);
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  const vaultChanges: VaultChangedEvent[] = [];
  const threads: ThreadChangedMessage[] = [];
  run(
    queryClient,
    (event) => {
      vaultChanges.push(event);
    },
    (message) => {
      threads.push(message);
    },
  );
  const invalidated = invalidateQueries.mock.calls.map(([filters]) => [
    ...(filters?.queryKey ?? []),
  ]);
  return { invalidated, queryClient, threads, vaultChanges };
};

const applyBatch = (
  messages: readonly ChangedMessage[],
  seed?: (queryClient: QueryClient) => void,
): Applied =>
  record((...args) => {
    const batch = new ChangeBatch();
    for (const message of messages) {
      batch.add(message);
    }
    batch.apply(...args);
  }, seed);

const apply = (...messages: ChangedMessage[]): Applied => applyBatch(messages);

const detailKey = (threadId: string): unknown[] => [
  ...orpc.threads.get.key({ input: { threadId } }),
];

const contentChanged = (id: string): ChangedMessage => ({
  changes: ["content-changed"],
  entity: "doc",
  id,
  type: "changed",
});

const threadChanged = (id: string, changes: readonly ThreadChangeKind[]): ChangedMessage => ({
  changes,
  entity: "thread",
  id,
  type: "changed",
});

describe("a doc change", () => {
  it("reaches the open note's reader and re-reads none of its bytes", () => {
    const applied = apply(contentChanged("notes/open.md"));

    expect(applied.vaultChanges).toEqual([{ kind: "content", path: "notes/open.md" }]);
    // the open note reads its own file; a `vaultFile` invalidation here read the same bytes twice per agent write.
    expect(applied.invalidated).toEqual([[...orpc.knowledge.key()]]);
  });

  it("refreshes the annotations when the doc is an annotation store", () => {
    // the second comment on a note rewrites an existing store: no files-changed follows it.
    const applied = apply(contentChanged(annotationsStorePath("note-id")));

    expect(applied.invalidated).toEqual([[...orpc.knowledge.key()], [...orpc.annotations.key()]]);
  });

  it("leaves the cached listing as it was: no surface reads a row's modified time from it", () => {
    const tree: VaultTreeResponse = {
      entries: [{ kind: "file", modifiedMs: 1, path: "a.md" }],
      name: "vault",
      root: "/vault",
    };
    const applied = applyBatch([contentChanged("a.md")], (queryClient) => {
      queryClient.setQueryData(orpc.vault.tree.queryKey(), tree);
    });

    expect(applied.queryClient.getQueryData(orpc.vault.tree.queryKey())).toBe(tree);
    expect(applied.invalidated).not.toContainEqual([...orpc.vault.tree.key()]);
  });
});

describe("a vault change", () => {
  it("sweeps the tree and tells the note session once, naming every moved path", () => {
    const applied = apply({
      changes: ["files-changed"],
      entity: "vault",
      paths: ["a.md", "b.md"],
      type: "changed",
    });

    expect(applied.invalidated).toEqual([
      [...orpc.vault.tree.key()],
      [...orpc.vault.deleted.key()],
      [...orpc.knowledge.key()],
      [...orpc.annotations.key()],
      [...orpc.threads.list.key()],
      [...orpc.threads.get.key()],
      [...orpc.threads.turnChanges.key()],
    ]);
    expect(applied.vaultChanges).toEqual([{ kind: "files", paths: ["a.md", "b.md"] }]);
  });

  it("re-reads every thread once, since a moved note re-points the actions it carries", () => {
    const applied = apply(threadChanged("t1", ["status-changed"]), {
      changes: ["files-changed"],
      entity: "vault",
      paths: ["notes/plans.md", "archive/plans.md"],
      type: "changed",
    });

    const threadKeys = applied.invalidated.filter((key) =>
      partialMatchKey(key, orpc.threads.key()),
    );
    expect(threadKeys).toEqual([
      [...orpc.threads.list.key()],
      [...orpc.threads.get.key()],
      [...orpc.threads.turnChanges.key()],
    ]);
    expect(applied.threads).toEqual([threadChanged("t1", ["status-changed"])]);
  });

  it("re-reads every thread's turn changes once, since a pull commits turns with no thread frame", () => {
    const pulled: ChangedMessage = {
      changes: ["files-changed"],
      entity: "vault",
      paths: ["notes/plans.md"],
      type: "changed",
    };

    expect(apply(pulled).invalidated).toContainEqual([...orpc.threads.turnChanges.key()]);

    const turnChangesKeys = apply(
      threadChanged("t1", ["changes-committed"]),
      pulled,
    ).invalidated.filter((key) => partialMatchKey(key, orpc.threads.turnChanges.key()));
    expect(turnChangesKeys).toEqual([[...orpc.threads.turnChanges.key()]]);
  });

  it("asserts nothing when it names no paths, so every note re-checks", () => {
    const applied = apply({ changes: ["files-changed"], entity: "vault", type: "changed" });

    expect(applied.vaultChanges).toEqual([{ kind: "files", paths: null }]);
  });

  it("sweeps both sync statuses on its own kind, the vault's git and the account's threads", () => {
    const applied = apply({
      changes: ["sync-status-changed"],
      entity: "vault",
      type: "changed",
    });

    expect(applied.invalidated).toEqual([
      [...orpc.vault.status.key()],
      [...orpc.cloud.status.key()],
    ]);
    expect(applied.vaultChanges).toEqual([]);
  });
});

describe("a burst of frames in one flush", () => {
  it("costs one knowledge sweep however many docs changed", () => {
    const frames = Array.from({ length: 200 }, (_, index) => contentChanged(`n${index % 20}.md`));
    const applied = applyBatch(frames);

    expect(applied.invalidated).toEqual([[...orpc.knowledge.key()]]);
    expect(applied.vaultChanges).toHaveLength(20);
  });

  it("folds a rename's rewrites into the files-changed sweep, naming each note once", () => {
    const applied = apply(
      contentChanged("a.md"),
      contentChanged("b.md"),
      {
        changes: ["files-changed"],
        entity: "vault",
        paths: ["old.md", "new.md", "a.md"],
        type: "changed",
      },
      contentChanged("b.md"),
    );

    expect(applied.invalidated.filter((key) => partialMatchKey(key, orpc.knowledge.key()))).toEqual(
      [[...orpc.knowledge.key()]],
    );
    expect(applied.vaultChanges).toEqual([
      { kind: "files", paths: ["old.md", "new.md", "a.md", "b.md"] },
    ]);
  });

  it("lets an unnamed vault change stand for every doc the burst named", () => {
    const applied = apply(contentChanged("a.md"), {
      changes: ["files-changed"],
      entity: "vault",
      type: "changed",
    });

    expect(applied.vaultChanges).toEqual([{ kind: "files", paths: null }]);
  });

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
    "origin-changed",
    "title-changed",
  ];
  const MOVES_DETAIL_ALONE: readonly ThreadChangeKind[] = ["queue-changed", "interactions-changed"];
  const MOVES_CHANGES_ALONE: readonly ThreadChangeKind[] = ["changes-committed"];
  const MOVES_NEITHER: readonly ThreadChangeKind[] = ["events-appended"];

  it("weighs every kind in the vocabulary here too", () => {
    expect(
      [
        ...MOVES_LIST_AND_DETAIL,
        ...MOVES_DETAIL_ALONE,
        ...MOVES_CHANGES_ALONE,
        ...MOVES_NEITHER,
      ].toSorted(),
    ).toEqual([...THREAD_CHANGE_KINDS].toSorted());
  });

  it.each(MOVES_CHANGES_ALONE)("%s moves that thread's recorded turn changes alone", (kind) => {
    const applied = apply(threadChanged("t1", [kind]));

    expect(applied.invalidated).toEqual([
      [...orpc.threads.turnChanges.key({ input: { threadId: "t1" } })],
    ]);
  });

  it("re-reads every thread's turn changes when a commit frame names no thread", () => {
    const applied = apply({ changes: ["changes-committed"], entity: "thread", type: "changed" });

    expect(applied.invalidated).toEqual([[...orpc.threads.turnChanges.key()]]);
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
    // one frame per flush: in a shared flush files-changed would stand in for the doc branch.
    const everyFrame = [
      apply({ changes: VAULT_CHANGE_KINDS, entity: "vault", type: "changed" }),
      apply(contentChanged(annotationsStorePath("note-id"))),
      apply(threadChanged("t1", THREAD_CHANGE_KINDS)),
      apply({ changes: THREAD_CHANGE_KINDS, entity: "thread", type: "changed" }),
    ].flatMap((applied) => applied.invalidated);
    const swept = record(sweepAfterReconnect).invalidated;

    const uncovered = everyFrame.filter(
      (frameKey) => !swept.some((sweptKey) => partialMatchKey(frameKey, sweptKey)),
    );
    expect(uncovered).toEqual([]);
    expect(swept).toContainEqual([...orpc.annotations.key()]);
  });

  it("tells every note and every thread to re-check", () => {
    const { vaultChanges, threads } = record(sweepAfterReconnect);

    expect(vaultChanges).toEqual([{ kind: "files", paths: null }]);
    expect(threads).toEqual([{ changes: THREAD_CHANGE_KINDS, entity: "thread", type: "changed" }]);
  });
});

describe("the library's own kinds", () => {
  const wikiTargetsKey = [...orpc.knowledge.wikiTargets.key()];

  it("refetches the import's status on import-changed, and no knowledge", () => {
    const applied = apply({ changes: ["import-changed"], entity: "vault", type: "changed" });

    expect(applied.invalidated).toEqual([[...orpc.imports.status.key()]]);
  });

  it("refetches the link targets on targets-changed alone", () => {
    const applied = apply({ changes: ["targets-changed"], entity: "vault", type: "changed" });

    expect(applied.invalidated).toEqual([wikiTargetsKey]);
  });

  it("keeps the targets out of the knowledge sweep a body edit or a listing change makes", () => {
    const frames: ChangedMessage[] = [
      contentChanged("notes/open.md"),
      { changes: ["files-changed"], entity: "vault", type: "changed" },
    ];
    for (const frame of frames) {
      const queryClient = new QueryClient();
      queryClient.setQueryData(orpc.knowledge.wikiTargets.queryKey(), { targets: [] });
      queryClient.setQueryData(orpc.knowledge.tags.queryKey(), { tags: [], total: 0 });
      const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
      const batch = new ChangeBatch();
      batch.add(frame);
      batch.apply(queryClient, vi.fn(), vi.fn());

      const sweep = invalidateQueries.mock.calls
        .map(([filters]) => filters)
        .find((filters) => partialMatchKey([...(filters?.queryKey ?? [])], orpc.knowledge.key()));
      const swept = queryClient
        .getQueryCache()
        .findAll({ queryKey: orpc.knowledge.key() })
        .filter((query) => sweep?.predicate?.(query) ?? true)
        .map((query) => [...query.queryKey]);
      expect(swept).toEqual([[...orpc.knowledge.tags.queryKey()]]);
    }
  });

  it("refetches the targets at most once per five seconds, folding the frames between", () => {
    vi.useFakeTimers();
    try {
      const queryClient = new QueryClient();
      const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
      const frame = (): void => {
        const batch = new ChangeBatch();
        batch.add({ changes: ["targets-changed"], entity: "vault", type: "changed" });
        batch.apply(queryClient, vi.fn(), vi.fn());
      };
      const refetches = (): number => invalidateQueries.mock.calls.length;

      frame();
      expect(refetches()).toBe(1);
      vi.advanceTimersByTime(1000);
      frame();
      vi.advanceTimersByTime(1000);
      frame();
      expect(refetches()).toBe(1);
      vi.advanceTimersByTime(3000);
      expect(refetches()).toBe(2);
      vi.advanceTimersByTime(10_000);
      expect(refetches()).toBe(2);
      frame();
      expect(refetches()).toBe(3);
      expect(
        invalidateQueries.mock.calls.every(([filters]) =>
          partialMatchKey([...(filters?.queryKey ?? [])], wikiTargetsKey),
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
