import { partialMatchKey, QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { ChangedMessage, ThreadChangedMessage } from "@repo/api/local/notifications";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import type { VaultChangedEvent } from "@repo/editor/host-io";
import { THREAD_CHANGE_KINDS, VAULT_CHANGE_KINDS } from "@repo/domain/change-kinds";
import { commentsStorePath } from "@repo/notes/comments/sidecar-schema";
import { describe, expect, it, vi } from "vitest";
import { orpc } from "../api";
import { ChangeBatch, sweepAfterReconnect } from "../workspace-context";

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

  it("refreshes the comments when the doc is a comment store", () => {
    // the second comment on a note rewrites an existing store: no files-changed follows it.
    const applied = apply(contentChanged(commentsStorePath("note-id")));

    expect(applied.invalidated).toEqual([[...orpc.knowledge.key()], [...orpc.comments.key()]]);
  });

  it("moves the edited note to now in the cached listing, and no other row", () => {
    const tree: VaultTreeResponse = {
      entries: [
        { kind: "dir", path: "notes" },
        { kind: "file", modifiedMs: 1, path: "notes/edited.md" },
        { kind: "file", modifiedMs: 1, path: "notes/untouched.md" },
      ],
      name: "vault",
      root: "/vault",
    };
    const before = Date.now();
    const applied = applyBatch([contentChanged("notes/edited.md")], (queryClient) => {
      queryClient.setQueryData(orpc.vault.tree.queryKey(), tree);
    });

    const patched = applied.queryClient.getQueryData(orpc.vault.tree.queryKey());
    const modified = new Map(
      patched?.entries.flatMap((entry) =>
        entry.kind === "file" ? [[entry.path, entry.modifiedMs]] : [],
      ),
    );
    expect(modified.get("notes/edited.md")).toBeGreaterThanOrEqual(before);
    expect(modified.get("notes/untouched.md")).toBe(1);
    expect(applied.invalidated).not.toContainEqual([...orpc.vault.tree.key()]);
  });

  it("leaves the cached listing as it was when the doc is not in it", () => {
    const tree: VaultTreeResponse = {
      entries: [{ kind: "file", modifiedMs: 1, path: "a.md" }],
      name: "vault",
      root: "/vault",
    };
    const applied = applyBatch([contentChanged("elsewhere.md")], (queryClient) => {
      queryClient.setQueryData(orpc.vault.tree.queryKey(), tree);
    });

    expect(applied.queryClient.getQueryData(orpc.vault.tree.queryKey())).toBe(tree);
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
      [...orpc.comments.key()],
      [...orpc.threads.list.key()],
      [...orpc.threads.get.key()],
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
    expect(threadKeys).toEqual([[...orpc.threads.list.key()], [...orpc.threads.get.key()]]);
    expect(applied.threads).toEqual([threadChanged("t1", ["status-changed"])]);
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
  const MOVES_NEITHER: readonly ThreadChangeKind[] = ["events-appended", "changes-committed"];

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

describe("the unlinked-mentions scan", () => {
  it("is the one knowledge query a content change leaves alone", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const batch = new ChangeBatch();
    batch.add(contentChanged("a.md"));
    batch.apply(
      queryClient,
      () => {},
      () => {},
    );
    // the predicate reads the key alone; the cache builds its Query from the same key
    const keys: readonly QueryKey[] = [
      orpc.knowledge.backlinks.key({ input: { path: "a.md" } }),
      orpc.knowledge.unlinkedMentions.key({ input: { path: "a.md" } }),
    ];
    const seen = invalidateQueries.mock.calls.flatMap(([filters]) =>
      keys.map((queryKey) => {
        const query = queryClient.getQueryCache().build(queryClient, { queryKey });
        return filters?.predicate === undefined || filters.predicate(query);
      }),
    );
    expect(seen).toEqual([true, false]);
  });
});

describe("a reconnect", () => {
  it("covers every query a frame can invalidate, since a gap in the socket produced none", () => {
    // one frame per flush: in a shared flush files-changed would stand in for the doc branch.
    const everyFrame = [
      apply({ changes: VAULT_CHANGE_KINDS, entity: "vault", type: "changed" }),
      apply(contentChanged(commentsStorePath("note-id"))),
      apply(threadChanged("t1", THREAD_CHANGE_KINDS)),
      apply({ changes: THREAD_CHANGE_KINDS, entity: "thread", type: "changed" }),
    ].flatMap((applied) => applied.invalidated);
    const swept = record(sweepAfterReconnect).invalidated;

    const uncovered = everyFrame.filter(
      (frameKey) => !swept.some((sweptKey) => partialMatchKey(frameKey, sweptKey)),
    );
    expect(uncovered).toEqual([]);
    expect(swept).toContainEqual([...orpc.comments.key()]);
  });

  it("tells every note and every thread to re-check", () => {
    const { vaultChanges, threads } = record(sweepAfterReconnect);

    expect(vaultChanges).toEqual([{ kind: "files", paths: null }]);
    expect(threads).toEqual([{ changes: THREAD_CHANGE_KINDS, entity: "thread", type: "changed" }]);
  });
});
