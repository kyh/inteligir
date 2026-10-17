import type { AnnotationEntry, AnnotationSource, AnnotationStore } from "./store-schema";

export interface AnnotationReply {
  id: string;
  entry: AnnotationEntry;
}

// a root entry and the replies under it
export interface AnnotationThread {
  id: string;
  root: AnnotationEntry;
  replies: AnnotationReply[];
  // false = entry with no body marker; listed anyway so it can be re-anchored or deleted
  anchored: boolean;
}

export interface AnnotationFold {
  annotations: AnnotationThread[];
  orphanMarkers: string[];
  // parent chain never reaches a root (dangling or cyclic parentId)
  strayIds: string[];
}

// markerIds null = doc unparseable: every annotation reports anchored and no orphan markers are
// claimed, since either claim would be a guess. Its order is the document's (`markerRootIds`
// visits each id's start marker first), so anchored roots read top to bottom and the unanchored
// follow by `createdAt`.
export const foldAnnotations = (
  store: AnnotationStore,
  markerIds: ReadonlySet<string> | null,
): AnnotationFold => {
  const childIds = new Map<string, string[]>();
  const rootIds: string[] = [];
  for (const [id, entry] of Object.entries(store)) {
    if (entry.parentId === undefined) {
      rootIds.push(id);
      continue;
    }
    const siblings = childIds.get(entry.parentId) ?? [];
    siblings.push(id);
    childIds.set(entry.parentId, siblings);
  }

  const byCreation = (a: string, b: string): number => {
    const ea = store[a];
    const eb = store[b];
    const at = (ea?.createdAt ?? 0) - (eb?.createdAt ?? 0);
    return at === 0 ? a.localeCompare(b) : at;
  };
  const position = new Map([...(markerIds ?? [])].map((id, index) => [id, index]));
  const inDocumentOrder = (a: string, b: string): number => {
    const pa = position.get(a);
    const pb = position.get(b);
    if (pa !== undefined && pb !== undefined) {
      return pa - pb;
    }
    if (pa !== undefined || pb !== undefined) {
      return pa === undefined ? 1 : -1;
    }
    return byCreation(a, b);
  };

  const reached = new Set<string>();
  const annotations: AnnotationThread[] = [];
  for (const rootId of rootIds.toSorted(inDocumentOrder)) {
    const root = store[rootId];
    if (root === undefined) {
      continue;
    }
    reached.add(rootId);
    const replies: AnnotationReply[] = [];
    const stack = (childIds.get(rootId) ?? []).toSorted(byCreation).toReversed();
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || reached.has(id)) {
        continue;
      }
      const entry = store[id];
      if (entry === undefined) {
        continue;
      }
      reached.add(id);
      replies.push({ entry, id });
      stack.push(...(childIds.get(id) ?? []).toSorted(byCreation).toReversed());
    }
    annotations.push({
      anchored: markerIds === null ? true : markerIds.has(rootId),
      id: rootId,
      replies,
      root,
    });
  }

  const strayIds = Object.keys(store).filter((id) => !reached.has(id));
  const orphanMarkers =
    markerIds === null ? [] : [...markerIds].filter((id) => store[id] === undefined).toSorted();
  return { annotations, orphanMarkers, strayIds };
};

export const rootOf = (store: AnnotationStore, id: string): string | null => {
  const seen = new Set<string>();
  let current = id;
  for (;;) {
    if (seen.has(current)) {
      return null;
    }
    seen.add(current);
    const entry = store[current];
    if (entry === undefined) {
      return null;
    }
    if (entry.parentId === undefined) {
      return current;
    }
    current = entry.parentId;
  }
};

export const threadIds = (store: AnnotationStore, rootId: string): string[] => {
  const members = [rootId];
  const collected = new Set(members);
  for (;;) {
    let grew = false;
    for (const [id, entry] of Object.entries(store)) {
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
  source: AnnotationSource;
  /** Unix seconds. */
  at: number;
}

export type AddResult = { ok: true; store: AnnotationStore } | { ok: false; error: string };

// `quote` is the passage's plain text when the highlight was made; `text` "" is a bare highlight
export const addRoot = (
  store: AnnotationStore,
  args: NewEntryArgs & { quote?: string },
): AddResult => {
  if (store[args.id] !== undefined) {
    return { error: `id ${args.id} already exists`, ok: false };
  }
  const entry: AnnotationEntry = {
    createdAt: args.at,
    source: args.source,
    text: args.text,
    updatedAt: args.at,
  };
  if (args.quote !== undefined) {
    entry.quote = args.quote;
  }
  return { ok: true, store: { ...store, [args.id]: entry } };
};

export const addReply = (
  store: AnnotationStore,
  args: NewEntryArgs & { parentId: string },
): AddResult => {
  if (store[args.id] !== undefined) {
    return { error: `id ${args.id} already exists`, ok: false };
  }
  if (store[args.parentId] === undefined) {
    return { error: `parent ${args.parentId} does not exist`, ok: false };
  }
  if (rootOf(store, args.parentId) === null) {
    return { error: `parent ${args.parentId} is not reachable from a root`, ok: false };
  }
  return {
    ok: true,
    store: {
      ...store,
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

// a root's note or a reply's text, rewritten in place and signed by whoever wrote it; the store's
// order is its thread order, so the entry keeps its place
export const editEntry = (store: AnnotationStore, args: NewEntryArgs): AddResult => {
  const entry = store[args.id];
  if (entry === undefined) {
    return { error: `${args.id} is not an annotation`, ok: false };
  }
  return {
    ok: true,
    store: {
      ...store,
      [args.id]: { ...entry, source: args.source, text: args.text, updatedAt: args.at },
    },
  };
};

export type DeleteResult =
  | { ok: true; store: AnnotationStore; removedIds: string[] }
  | { ok: false; error: string };

// body markers are the caller's to strip
export const deleteAnnotation = (store: AnnotationStore, rootId: string): DeleteResult => {
  const root = store[rootId];
  if (root === undefined || root.parentId !== undefined) {
    return { error: `${rootId} is not a root annotation`, ok: false };
  }
  const members = new Set(threadIds(store, rootId));
  const next: AnnotationStore = {};
  for (const [id, entry] of Object.entries(store)) {
    if (!members.has(id)) {
      next[id] = entry;
    }
  }
  return { ok: true, removedIds: [...members], store: next };
};
