import { vaultChangePaths } from "@repo/contract/cloud/vault/vault-commit-schema";
import type {
  VaultCommitConflict,
  VaultCommitResponse,
} from "@repo/contract/cloud/vault/vault-commit-schema";
import {
  deviceCommitEmail,
  vaultCommitSubject,
  WORKER_COMMITTER_EMAIL,
} from "@repo/contract/cloud/vault/vault-git";
import { VAULT_FILE_MAX_BYTES } from "@repo/contract/cloud/vault/vault-schema";
import type { RepoCell } from "durable-git";
import { blobObject, commitObject, gitIdent, writePack } from "./git-objects";
import { isRegularFile, planChangeSet } from "./plan-change-set";
import type { PendingConflict, PreparedChange } from "./plan-change-set";
import type { VaultPackPush, VaultPushOutcome } from "./receive-pack";
import { encodeGitPath } from "./tree-walk";

// The set lands on the head it was checked against or not at all, and satisfying what that head
// already holds is what makes a resend harmless without an idempotency key.

export type VaultChange =
  | {
      readonly op: "put";
      readonly path: string;
      readonly base: string | null;
      readonly bytes: Uint8Array;
    }
  | Exclude<PreparedChange, { readonly op: "put" }>;

export type VaultConflict = VaultCommitConflict["conflicts"][number];

type VaultChangeResult = VaultCommitResponse["results"][number];

export type CommitChangesResult =
  | {
      readonly kind: "committed";
      readonly commit: string;
      readonly results: VaultChangeResult[];
    }
  | {
      readonly kind: "conflict";
      readonly head: string;
      readonly conflicts: VaultConflict[];
    }
  | { readonly kind: "no-head" }
  | { readonly kind: "full" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "exhausted" };

export interface CommitChangesArgs {
  readonly stub: DurableObjectStub<RepoCell>;
  readonly send: (push: VaultPackPush) => Promise<VaultPushOutcome>;
  readonly changes: readonly VaultChange[];
  readonly author: { readonly deviceId: string; readonly deviceName: string };
  // unix ms: when the device made the change, and when the Worker commits it
  readonly authoredAt: number;
  readonly now: number;
}

// a head that moves under three attempts in one request is a device pushing in a loop; the phone's
// queue sends the set again later
const MAX_ATTEMPTS = 3;

// a conflict answers whole notes so the phone merges in one pass; past this it reads the rest at
// the conflict's head
const CONFLICT_INLINE_BYTES = 8 * 1024 * 1024;

const prepare = async (change: VaultChange): Promise<PreparedChange> =>
  change.op === "put"
    ? { base: change.base, blob: await blobObject(change.bytes), op: "put", path: change.path }
    : change;

const resultOf = (change: PreparedChange): VaultChangeResult => {
  switch (change.op) {
    case "put": {
      return { oid: change.blob.oid, path: change.path };
    }
    case "delete": {
      return { oid: null, path: change.path };
    }
    case "move": {
      return { oid: change.base, path: change.to };
    }
    default: {
      const exhaustive: never = change;
      return exhaustive;
    }
  }
};

interface Head {
  readonly ref: string;
  // what the ref holds, which the push's CAS names
  readonly target: string;
  readonly commit: string;
}

const readHead = async (stub: DurableObjectStub<RepoCell>): Promise<Head | null> => {
  const { head, refs } = await stub.listRefs();
  const target = refs.find((ref) => ref.name === head)?.target;
  if (head === null || target === undefined) {
    return null;
  }
  const commit = await stub.readCommit(target);
  return commit === null ? null : { commit: commit.oid, ref: head, target };
};

const decodeText = (bytes: Uint8Array): string | undefined => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
};

const describeConflicts = async (
  stub: DurableObjectStub<RepoCell>,
  commit: string,
  pending: readonly PendingConflict[],
): Promise<VaultConflict[]> => {
  let budget = CONFLICT_INLINE_BYTES;
  const inline = pending.map(({ entry }) => {
    const size = entry !== null && isRegularFile(entry) ? entry.size : undefined;
    if (size === undefined || size > VAULT_FILE_MAX_BYTES || size > budget) {
      return false;
    }
    budget -= size;
    return true;
  });
  return await Promise.all(
    pending.map(async ({ entry, path, reason }, index): Promise<VaultConflict> => {
      const [text, log] = await Promise.all([
        inline[index] === true
          ? stub
              .readBlob(commit, encodeGitPath(path))
              .then((blob) => (blob === null ? undefined : decodeText(blob.data)))
          : undefined,
        stub.listLog(commit, { n: 1, path: encodeGitPath(path) }),
      ]);
      let current: VaultConflict["current"] = null;
      if (entry !== null) {
        current = text === undefined ? { oid: entry.oid } : { content: text, oid: entry.oid };
      }
      return { current, device: log.commits[0]?.committer.name ?? null, path, reason };
    }),
  );
};

export const commitChanges = async ({
  author,
  authoredAt,
  changes,
  now,
  send,
  stub,
}: CommitChangesArgs): Promise<CommitChangesResult> => {
  const named = changes.flatMap(vaultChangePaths);
  if (new Set(named).size !== named.length) {
    throw new Error("a change set names a path twice");
  }
  const prepared = await Promise.all(changes.map(prepare));
  const results = prepared.map(resultOf);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const head = await readHead(stub);
    if (head === null) {
      return { kind: "no-head" };
    }
    const plan = await planChangeSet(
      async (dir) => await stub.listTree(head.commit, encodeGitPath(dir)),
      prepared,
    );
    if (plan.kind === "conflict") {
      return {
        conflicts: await describeConflicts(stub, head.commit, plan.conflicts),
        head: head.commit,
        kind: "conflict",
      };
    }
    if (plan.kind === "satisfied") {
      return { commit: head.commit, kind: "committed", results };
    }
    const commit = await commitObject({
      author: gitIdent(
        { email: deviceCommitEmail(author.deviceId), name: author.deviceName },
        authoredAt,
      ),
      committer: gitIdent({ email: WORKER_COMMITTER_EMAIL, name: author.deviceName }, now),
      message: vaultCommitSubject(plan.touched),
      parents: [head.commit],
      tree: plan.root,
    });
    const outcome = await send({
      next: commit.oid,
      old: head.target,
      pack: await writePack([...plan.objects, commit]),
      ref: head.ref,
    });
    if (outcome.kind === "applied") {
      return { commit: commit.oid, kind: "committed", results };
    }
    if (outcome.kind === "full") {
      return { kind: "full" };
    }
    if (outcome.kind === "refused") {
      return { kind: "refused", reason: outcome.reason };
    }
  }
  return { kind: "exhausted" };
};
