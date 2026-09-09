import type { CommentEntry, CommentSidecar, CommentSource } from "./sidecar-schema";

export interface CommentReply {
  id: string;
  entry: CommentEntry;
}

export interface CommentThread {
  rootId: string;
  root: CommentEntry;
  replies: CommentReply[];
  resolved: boolean;
  // false = entry with no body marker; listed anyway so it can be re-anchored or deleted
  anchored: boolean;
}

export interface SidecarThreads {
  threads: CommentThread[];
  orphanMarkers: string[];
  // parent chain never reaches a root (dangling or cyclic parentId)
  strayIds: string[];
}

// markerIds null = doc unparseable: every thread reports anchored and no orphan
// markers are claimed, since either claim would be a guess.
export const foldThreads = (
  sidecar: CommentSidecar,
  markerIds: Set<string> | null,
): SidecarThreads => {
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
    return at === 0 ? a.localeCompare(b) : at;
  };

  const reached = new Set<string>();
  const threads: CommentThread[] = [];
  for (const rootId of rootIds) {
    const root = sidecar[rootId];
    if (root === undefined) {
      continue;
    }
    reached.add(rootId);
    const replies: CommentReply[] = [];
    const stack = (childIds.get(rootId) ?? []).toSorted(byCreation).toReversed();
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || reached.has(id)) {
        continue;
      }
      const entry = sidecar[id];
      if (entry === undefined) {
        continue;
      }
      reached.add(id);
      replies.push({ entry, id });
      stack.push(...(childIds.get(id) ?? []).toSorted(byCreation).toReversed());
    }
    threads.push({
      anchored: markerIds === null ? true : markerIds.has(rootId),
      replies,
      resolved: root.resolvedAt !== undefined,
      root,
      rootId,
    });
  }

  const strayIds = Object.keys(sidecar).filter((id) => !reached.has(id));
  const orphanMarkers =
    markerIds === null ? [] : [...markerIds].filter((id) => sidecar[id] === undefined).toSorted();
  return { orphanMarkers, strayIds, threads };
};

export const rootOf = (sidecar: CommentSidecar, id: string): string | null => {
  const seen = new Set<string>();
  let current = id;
  for (;;) {
    if (seen.has(current)) {
      return null;
    }
    seen.add(current);
    const entry = sidecar[current];
    if (entry === undefined) {
      return null;
    }
    if (entry.parentId === undefined) {
      return current;
    }
    current = entry.parentId;
  }
};

export const threadIds = (sidecar: CommentSidecar, rootId: string): string[] => {
  const members = [rootId];
  const collected = new Set(members);
  for (;;) {
    let grew = false;
    for (const [id, entry] of Object.entries(sidecar)) {
      if (collected.has(id) || entry.parentId === undefined) {
        continue;
      }
      if (collected.has(entry.parentId)) {
        collected.add(id);
        members.push(id);
        grew = true;
      }
    }
    if (!grew) {
      return members;
    }
  }
};

export interface NewEntryArgs {
  id: string;
  text: string;
  source: CommentSource;
  /** Unix seconds. */
  at: number;
}

export type AddResult = { ok: true; sidecar: CommentSidecar } | { ok: false; error: string };

export const addRoot = (sidecar: CommentSidecar, args: NewEntryArgs): AddResult => {
  if (sidecar[args.id] !== undefined) {
    return { error: `id ${args.id} already exists`, ok: false };
  }
  return {
    ok: true,
    sidecar: {
      ...sidecar,
      [args.id]: { createdAt: args.at, source: args.source, text: args.text, updatedAt: args.at },
    },
  };
};

export const addReply = (
  sidecar: CommentSidecar,
  args: NewEntryArgs & { parentId: string },
): AddResult => {
  if (sidecar[args.id] !== undefined) {
    return { error: `id ${args.id} already exists`, ok: false };
  }
  if (sidecar[args.parentId] === undefined) {
    return { error: `parent ${args.parentId} does not exist`, ok: false };
  }
  if (rootOf(sidecar, args.parentId) === null) {
    return { error: `parent ${args.parentId} is not reachable from a root`, ok: false };
  }
  return {
    ok: true,
    sidecar: {
      ...sidecar,
      [args.id]: {
        createdAt: args.at,
        parentId: args.parentId,
        source: args.source,
        text: args.text,
        updatedAt: args.at,
      },
    },
  };
};

export interface ResolveArgs {
  rootId: string;
  resolved: boolean;
  by: CommentSource;
  /** Unix seconds. */
  at: number;
}

export const resolveThread = (sidecar: CommentSidecar, args: ResolveArgs): AddResult => {
  const root = sidecar[args.rootId];
  if (root === undefined || root.parentId !== undefined) {
    return { error: `${args.rootId} is not a root comment`, ok: false };
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
};

export type DeleteResult =
  | { ok: true; sidecar: CommentSidecar; removedIds: string[] }
  | { ok: false; error: string };

// body markers are the caller's to strip
export const deleteThread = (sidecar: CommentSidecar, rootId: string): DeleteResult => {
  const root = sidecar[rootId];
  if (root === undefined || root.parentId !== undefined) {
    return { error: `${rootId} is not a root comment`, ok: false };
  }
  const members = new Set(threadIds(sidecar, rootId));
  const next: CommentSidecar = {};
  for (const [id, entry] of Object.entries(sidecar)) {
    if (!members.has(id)) {
      next[id] = entry;
    }
  }
  return { ok: true, removedIds: [...members], sidecar: next };
};
