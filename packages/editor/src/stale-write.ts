// The one answer to "what does a stale write do?", whichever store it meets. A note is written
// against the bytes it was read as, a write whose file moved is diff3-merged with the bytes now
// there and retried once against them, and a create carries no base; a host adapts its store to
// the port and keeps nothing of the policy. A block two writers changed is merged the same way,
// three ways over each side's markdown (`codec/block-markdown.ts`), and the replica runs it over
// every block a CONFLICT names (`mergeBlocks`).

import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { mergeItemTexts } from "@repo/notes/sync/url-item-verdict";
import { diff3 } from "@repo/notes/text/diff3";

import { blockFromMarkdown, faithfulMarkdown, filesIn, renamedBlock } from "./codec/block-markdown";
import type { CreateOutcome, VaultIO, WriteOutcome } from "@repo/editor/vault-editor";

// `absent` is a create, and carries no base: bytes not yet on disk are nothing a CAS could match.
// `expected` names the bytes the write was computed from, which the host turns into whatever its
// store compares (a content hash, a blob id).
export type GuardedWrite =
  | { readonly kind: "absent" }
  | { readonly kind: "expected"; readonly base: string };

// `exists` answers `absent` alone; `changed` (the bytes on disk now) and `missing` (a delete raced
// the write) answer `expected` alone.
export type GuardedWriteResult =
  | { readonly kind: "written" }
  | { readonly kind: "exists" }
  | { readonly kind: "changed"; readonly current: string }
  | { readonly kind: "missing" };

export interface GuardedVaultPort {
  readonly read: (path: string) => Promise<string>;
  // resolves every refusal a guard names, and rejects on any other failure.
  readonly write: (
    path: string,
    content: string,
    guard: GuardedWrite,
  ) => Promise<GuardedWriteResult>;
  // resolves once the file is gone, whether it removed it or found none there.
  readonly remove: (path: string) => Promise<void>;
}

const refused = (what: string, result: GuardedWriteResult): Error =>
  new Error(`${what}: the library answered ${result.kind}`);

export const createGuardedVaultIo = (port: GuardedVaultPort): VaultIO => {
  const bases = new Map<string, string>();

  const landed = (path: string, content: string, conflicted: boolean): WriteOutcome => {
    bases.set(path, content);
    return { conflicted, content, kind: "landed" };
  };

  const read = async (path: string): Promise<string> => {
    const content = await port.read(path);
    bases.set(path, content);
    return content;
  };

  const create = async (path: string, content: string): Promise<CreateOutcome> => {
    const result = await port.write(path, content, { kind: "absent" });
    if (result.kind === "written") {
      bases.set(path, content);
      return { kind: "created" };
    }
    if (result.kind === "exists") {
      return { kind: "exists" };
    }
    throw refused(`create ${path}`, result);
  };

  const write = async (path: string, content: string): Promise<WriteOutcome> => {
    const base = bases.get(path);
    // Not inferred from `content`: that would let a concurrent edit merge to
    // the disk's bytes alone and drop this write silently.
    if (base === undefined) {
      throw new Error(`write ${path}: no base was read, so nothing can guard this write`);
    }
    const result = await port.write(path, content, { base, kind: "expected" });
    if (result.kind === "written") {
      return landed(path, content, false);
    }
    if (result.kind === "missing") {
      return { kind: "vanished" };
    }
    if (result.kind === "exists") {
      throw refused(`write ${path}`, result);
    }
    const { conflicted, merged } = mergeItemTexts(base, content, result.current);
    const retry = await port.write(path, merged, { base: result.current, kind: "expected" });
    if (retry.kind === "written") {
      return landed(path, merged, conflicted);
    }
    if (retry.kind === "missing") {
      return { kind: "vanished" };
    }
    throw refused(`write ${path} after a merge`, retry);
  };

  const remove = async (path: string): Promise<void> => {
    await port.remove(path);
    bases.delete(path);
  };

  return { create, read, remove, write };
};

// a block two writers changed, as the replica hands it over: `base` as this device's write was
// computed from it, `mine` as it wrote it, `theirs` as the cell holds it now
export interface BlockSides {
  readonly base: LibraryBlock;
  readonly mine: LibraryBlock;
  readonly theirs: LibraryBlock;
}

// a block both sides changed, merged: `overlapped` where both changed the same lines and mine
// were kept over theirs, which the person is told of, as a note's merge says so
export interface MergedBlock {
  readonly block: LibraryBlock;
  readonly overlapped: boolean;
}

// the replica's block merge (`@repo/library-replica`'s `BlockMerge`): the lines each side changed
// both land and an overlap keeps mine, as a note's merge does; a side whose markdown does not read
// back as itself, or a merge that reads back as no one block, keeps mine whole over theirs, an
// overlap too. The answer keeps theirs' id, and the `ref` whichever side moved it.
export const mergeBlocks = ({ base, mine, theirs }: BlockSides): MergedBlock => {
  const ref = mine.ref === base.ref ? theirs.ref : mine.ref;
  const kept = (block: LibraryBlock, overlapped: boolean): MergedBlock => ({
    block: renamedBlock(block, theirs.id, ref),
    overlapped,
  });
  const files = filesIn([base, mine, theirs]);
  const baseText = faithfulMarkdown(base, files);
  const mineText = faithfulMarkdown(mine, files);
  const theirsText = faithfulMarkdown(theirs, files);
  if (baseText === null || mineText === null || theirsText === null) {
    return kept(mine, true);
  }
  const { conflicted, merged } = diff3(baseText, mineText, theirsText);
  if (merged === mineText) {
    return kept(mine, conflicted);
  }
  if (merged === theirsText) {
    return kept(theirs, conflicted);
  }
  const read = blockFromMarkdown(merged, theirs.id, files);
  return read === null ? kept(mine, true) : kept(read, conflicted);
};
