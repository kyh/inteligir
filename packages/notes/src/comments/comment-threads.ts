import type { CommentEntry, CommentSidecar, CommentSource } from "./sidecar-schema";

export type CommentReply = { id: string; entry: CommentEntry };

export type CommentThread = {
  rootId: string;
  root: CommentEntry;
  replies: CommentReply[];
  resolved: boolean;
  // false = entry with no body marker; listed anyway so it can be re-anchored or deleted
  anchored: boolean;
};

export type SidecarThreads = {
  threads: CommentThread[];
  orphanMarkers: string[];
  // parent chain never reaches a root (dangling or cyclic parentId)
  strayIds: string[];
};

// markerIds null = doc unparseable: every thread reports anchored and no orphan
// markers are claimed, since either claim would be a guess.
export function foldThreads(
  sidecar: CommentSidecar,
  markerIds: Set<string> | null,
): SidecarThreads {
  const childIds = new Map<string, string[]>();
  const rootIds: string[] = [];
  for (const [id, entry] of Object.entries(sidecar)) {
    if (entry.parentId === undefined) {
      rootIds.push(id);
      continue;
    }
    const siblings = childIds.get(entry.parentId) ?? [];
    siblings.push(id);
    childIds.set(entry.parentId, siblings);
  }

  const byCreation = (a: string, b: string): number => {
    const ea = sidecar[a];
    const eb = sidecar[b];
    const at = (ea?.createdAt ?? 0) - (eb?.createdAt ?? 0);
    return at !== 0 ? at : a.localeCompare(b);
  };

  const reached = new Set<string>();
  const threads: CommentThread[] = [];
  for (const rootId of rootIds) {
    const root = sidecar[rootId];
    if (root === undefined) continue;
    reached.add(rootId);
    const replies: CommentReply[] = [];
    const stack = (childIds.get(rootId) ?? []).toSorted(byCreation).toReversed();
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || reached.has(id)) continue;
      const entry = sidecar[id];
      if (entry === undefined) continue;
      reached.add(id);
      replies.push({ id, entry });
      stack.push(...(childIds.get(id) ?? []).toSorted(byCreation).toReversed());
    }
    threads.push({
      rootId,
      root,
      replies,
      resolved: root.resolvedAt !== undefined,
      anchored: markerIds === null ? true : markerIds.has(rootId),
    });
  }

  const strayIds = Object.keys(sidecar).filter((id) => !reached.has(id));
  const orphanMarkers =
    markerIds === null ? [] : [...markerIds].filter((id) => sidecar[id] === undefined).toSorted();
  return { threads, orphanMarkers, strayIds };
}

export function rootOf(sidecar: CommentSidecar, id: string): string | null {
  const seen = new Set<string>();
  let current = id;
  for (;;) {
    if (seen.has(current)) return null;
    seen.add(current);
    const entry = sidecar[current];
    if (entry === undefined) return null;
    if (entry.parentId === undefined) return current;
    current = entry.parentId;
  }
}

export function threadIds(sidecar: CommentSidecar, rootId: string): string[] {
  const members = [rootId];
  const collected = new Set(members);
  for (;;) {
    let grew = false;
    for (const [id, entry] of Object.entries(sidecar)) {
      if (collected.has(id) || entry.parentId === undefined) continue;
      if (collected.has(entry.parentId)) {
        collected.add(id);
        members.push(id);
        grew = true;
      }
    }
    if (!grew) return members;
  }
}

export type NewEntryArgs = {
  id: string;
  text: string;
  source: CommentSource;
  /** Unix seconds. */
  at: number;
};

export type AddResult = { ok: true; sidecar: CommentSidecar } | { ok: false; error: string };

export function addRoot(sidecar: CommentSidecar, args: NewEntryArgs): AddResult {
  if (sidecar[args.id] !== undefined) return { ok: false, error: `id ${args.id} already exists` };
  return {
    ok: true,
    sidecar: {
      ...sidecar,
      [args.id]: { text: args.text, createdAt: args.at, updatedAt: args.at, source: args.source },
    },
  };
}

export function addReply(
  sidecar: CommentSidecar,
  args: NewEntryArgs & { parentId: string },
): AddResult {
  if (sidecar[args.id] !== undefined) return { ok: false, error: `id ${args.id} already exists` };
  if (sidecar[args.parentId] === undefined) {
    return { ok: false, error: `parent ${args.parentId} does not exist` };
  }
  if (rootOf(sidecar, args.parentId) === null) {
    return { ok: false, error: `parent ${args.parentId} is not reachable from a root` };
  }
  return {
    ok: true,
    sidecar: {
      ...sidecar,
      [args.id]: {
        text: args.text,
        createdAt: args.at,
        updatedAt: args.at,
        source: args.source,
        parentId: args.parentId,
      },
    },
  };
}

export type ResolveArgs = {
  rootId: string;
  resolved: boolean;
  by: CommentSource;
  /** Unix seconds. */
  at: number;
};

export function resolveThread(sidecar: CommentSidecar, args: ResolveArgs): AddResult {
  const root = sidecar[args.rootId];
  if (root === undefined || root.parentId !== undefined) {
    return { ok: false, error: `${args.rootId} is not a root comment` };
  }
  const members = new Set(threadIds(sidecar, args.rootId));
  const next: CommentSidecar = {};
  for (const [id, entry] of Object.entries(sidecar)) {
    if (!members.has(id)) {
      next[id] = entry;
      continue;
    }
    if (args.resolved) {
      next[id] = { ...entry, resolvedAt: args.at, resolvedBy: args.by, updatedAt: args.at };
    } else {
      const { resolvedAt, resolvedBy, ...rest } = entry;
      void resolvedAt;
      void resolvedBy;
      next[id] = { ...rest, updatedAt: args.at };
    }
  }
  return { ok: true, sidecar: next };
}

export type DeleteResult =
  | { ok: true; sidecar: CommentSidecar; removedIds: string[] }
  | { ok: false; error: string };

// body markers are the caller's to strip
export function deleteThread(sidecar: CommentSidecar, rootId: string): DeleteResult {
  const root = sidecar[rootId];
  if (root === undefined || root.parentId !== undefined) {
    return { ok: false, error: `${rootId} is not a root comment` };
  }
  const members = new Set(threadIds(sidecar, rootId));
  const next: CommentSidecar = {};
  for (const [id, entry] of Object.entries(sidecar)) {
    if (!members.has(id)) next[id] = entry;
  }
  return { ok: true, sidecar: next, removedIds: [...members] };
}
