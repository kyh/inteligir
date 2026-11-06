import type { AnnotationEntry, AnnotationStore } from "./store-schema";

interface AnnotationReply {
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
// claimed, since either claim would be a guess. Its order is the document's (the caller lists each
// id where its first marker sits), so anchored roots read top to bottom and the unanchored follow
// by `createdAt`.
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
