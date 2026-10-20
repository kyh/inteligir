// the store is an ordinary vault file, so containment, notify, auto-commit and sync ride the write.
// every mutation is a cas against the bytes it was folded from: the panel and the agent's cli are two
// writers of one file, and a plain write lets the second erase the first's entry. one retry is safe
// because every annotation edit is additive over ids.

import {
  addReply,
  addRoot,
  deleteAnnotation,
  editEntry,
  foldAnnotations,
} from "@repo/notes/annotations/annotation-threads";
import type { AnnotationFold } from "@repo/notes/annotations/annotation-threads";
import { markerRootIds } from "@repo/notes/annotations/marker-ids";
import {
  annotationsStorePath,
  isNoteIdKey,
  parseAnnotationStore,
  serializeAnnotationStore,
} from "@repo/notes/annotations/store-schema";
import type { AnnotationSource, AnnotationStore } from "@repo/notes/annotations/store-schema";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import type {
  AnnotationEntryWire,
  AnnotationState,
  AnnotationsAddRequest,
  AnnotationsEditRequest,
  AnnotationsRemoveRequest,
  AnnotationsRemoveResponse,
  AnnotationsReplyRequest,
  AnnotationsResponse,
} from "@repo/contract/local/annotations/annotations-schema";
import { annotationPassages } from "@repo/notes/annotations/passage-text";
import {
  placeQuotes,
  stripAnnotationMarkers,
  waitingQuotes,
} from "@repo/notes/annotations/place-quotes";
import { ANNOTATIONS_MAX } from "@repo/contract/local/annotations/annotations-schema";

import type { KnowledgeRuntime } from "../knowledge/knowledge-runtime";
import { ensureNoteId } from "../vault/ensure-note-id";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";

// ANNOTATIONS_REFUSALS is total over this union, so a code added here without a wire class fails to
// compile there.
export type AnnotationsErrorCode =
  | "refused"
  | "conflict"
  // a store that does not parse, not folded to `{}`: an empty fold lets the next write erase every
  // thread an external writer left.
  | "invalid"
  // `add` with `place`: the quote is nowhere in the item's text
  | "passage-not-found";

export class AnnotationsError extends Error {
  readonly code: AnnotationsErrorCode;

  constructor(code: AnnotationsErrorCode, message: string) {
    super(message);
    this.name = "AnnotationsError";
    this.code = code;
  }
}

// unix seconds, the store's unit.
type AnnotationsClock = () => number;

// a call's answer and every vault path it wrote on the way (the store, a note it minted an id
// into), so an agent's turn can commit what its shell caused.
export interface AnnotationsWrite<T> {
  answer: T;
  wrote: string[];
}

// a root the import or a capture stores before the item's text can hold its markers
interface UnanchoredEntry {
  id: string;
  quote: string;
  text: string;
  source: AnnotationSource;
  // unix seconds
  createdAt: number;
}

export interface AnnotationsService {
  list: (path: string) => Promise<AnnotationsResponse>;
  // with `place`, the markers are written around the quote's occurrence in the item's text
  add: (args: AnnotationsAddRequest) => Promise<AnnotationsWrite<AnnotationsResponse>>;
  edit: (args: AnnotationsEditRequest) => Promise<AnnotationsWrite<AnnotationsResponse>>;
  reply: (args: AnnotationsReplyRequest) => Promise<AnnotationsWrite<AnnotationsResponse>>;
  // `stripMarkers` also takes the removed ids' markers out of the item's text
  remove: (args: AnnotationsRemoveRequest) => Promise<AnnotationsWrite<AnnotationsRemoveResponse>>;
  // store-only: unanchored roots with a quote, keyed by the item's id, the store created if absent;
  // an id the store already holds is kept as it is, so a resumed import adds nothing twice
  addUnanchored: (args: {
    itemId: string;
    entries: readonly UnanchoredEntry[];
  }) => Promise<AnnotationsWrite<{ path: string }>>;
  // the waiting roots of `itemId` placed into `content`, or only those `only` names; `final`
  // appends what found no passage under a Highlights section. pure over the store it reads: the
  // caller writes `content` under its own compare-and-swap
  placeWaiting: (args: {
    path: string;
    itemId: string | null;
    content: string;
    final: boolean;
    only?: readonly string[];
  }) => Promise<{ content: string; placed: string[] }>;
}

export interface AnnotationsServiceDeps {
  service: VaultService;
  // where an item is now, by its id
  knowledge: Pick<KnowledgeRuntime, "pathForNoteId">;
  now: AnnotationsClock;
}

// an explicit projection, not a spread: the file keeps fields the contract does not declare.
const toWire = (entry: AnnotationStore[string]): AnnotationEntryWire => {
  const wire: AnnotationEntryWire = {
    createdAt: entry.createdAt,
    text: entry.text,
    updatedAt: entry.updatedAt,
  };
  if (entry.source !== undefined) {
    wire.source = entry.source;
  }
  if (entry.parentId !== undefined) {
    wire.parentId = entry.parentId;
  }
  if (entry.quote !== undefined) {
    wire.quote = entry.quote;
  }
  return wire;
};

// an unanchored root on a stub is waiting, since its fill will place it; on any other item it is
// missing for good
const stateOf = (anchored: boolean, onStub: boolean): AnnotationState => {
  if (anchored) {
    return "anchored";
  }
  return onStub ? "waiting" : "missing";
};

const toResponse = (
  path: string,
  folded: AnnotationFold,
  facts: { onStub: boolean; passages: ReadonlyMap<string, string> },
): AnnotationsResponse => ({
  orphanMarkers: folded.orphanMarkers,
  path,
  strayIds: folded.strayIds,
  annotations: folded.annotations.slice(0, ANNOTATIONS_MAX).map((annotation) => ({
    id: annotation.id,
    passage: facts.passages.get(annotation.id) ?? null,
    quote: annotation.root.quote ?? null,
    replies: annotation.replies.map((reply) => ({ entry: toWire(reply.entry), id: reply.id })),
    root: toWire(annotation.root),
    state: stateOf(annotation.anchored, facts.onStub),
  })),
  total: folded.annotations.length,
});

interface StoreBase {
  entries: AnnotationStore;
  raw: string | null;
}

interface EditApplied {
  ok: true;
  store: AnnotationStore;
}
interface EditRefused {
  ok: false;
  error: string;
}

// the note's bytes and the id they carry; `id` is null for a note that has none yet
interface NoteRead {
  content: string;
  id: string | null;
}

const DEFAULT_SOURCE: AnnotationSource = "user";

// the key names a file, so an id that cannot is refused rather than escaping the store's folder
const keyOf = (notePath: string, id: string): string => {
  if (!isNoteIdKey(id)) {
    throw new AnnotationsError(
      "refused",
      `${notePath}: its id ${JSON.stringify(id)} cannot name a file`,
    );
  }
  return id;
};

const answer = (notePath: string, note: NoteRead, entries: AnnotationStore): AnnotationsResponse =>
  toResponse(notePath, foldAnnotations(entries, markerRootIds(note.content)), {
    onStub: isItemStub(itemFactsOf(note.content)),
    passages: annotationPassages(note.content),
  });

const PASSAGE_NOT_FOUND = "That passage isn't in the item's text.";

const holdsPassage = (
  content: string,
  request: { id: string; place: { occurrence: number }; quote: string },
): boolean =>
  placeQuotes(
    content,
    [{ id: request.id, occurrence: request.place.occurrence, quote: request.quote }],
    {
      final: false,
    },
  ).placed.includes(request.id);

// the paths one call wrote, gathered as each write lands.
type Wrote = Set<string>;

const tracked = async <T>(work: (wrote: Wrote) => Promise<T>): Promise<AnnotationsWrite<T>> => {
  const wrote: Wrote = new Set();
  const result = await work(wrote);
  return { answer: result, wrote: [...wrote] };
};

// the root's entries in order, those the store already holds left out
const withUnanchored = (
  store: AnnotationStore,
  entries: readonly UnanchoredEntry[],
): EditApplied | EditRefused => {
  let next = store;
  for (const entry of entries) {
    if (next[entry.id] !== undefined) {
      continue;
    }
    const added = addRoot(next, {
      at: entry.createdAt,
      id: entry.id,
      quote: entry.quote,
      source: entry.source,
      text: entry.text,
    });
    if (!added.ok) {
      return added;
    }
    next = added.store;
  }
  return { ok: true, store: next };
};

export const createAnnotationsService = ({
  service: vault,
  now,
}: AnnotationsServiceDeps): AnnotationsService => {
  const readNote = async (notePath: string): Promise<NoteRead> => {
    const { content } = await vault.read(notePath);
    return { content, id: frontmatterId(content) };
  };

  const storeKeyOf = async (notePath: string, note: NoteRead, wrote: Wrote): Promise<string> => {
    const outcome = await ensureNoteId(vault, notePath, note.content);
    switch (outcome.kind) {
      case "id": {
        if (outcome.minted) {
          wrote.add(notePath);
        }
        return keyOf(notePath, outcome.id);
      }
      case "invalid": {
        throw new AnnotationsError(
          "refused",
          `${notePath}: the frontmatter is not valid YAML, so no id can be written into it`,
        );
      }
      case "foreign-id": {
        throw new AnnotationsError(
          "refused",
          `${notePath}: its frontmatter id ${outcome.value} is not text, and a minted id would replace it`,
        );
      }
      case "changed": {
        throw new AnnotationsError(
          "conflict",
          `${notePath} changed under the id write twice; nothing was written`,
        );
      }
      // no default
    }
  };

  const readStore = async (noteId: string): Promise<StoreBase> => {
    const path = annotationsStorePath(noteId);
    let raw: string;
    try {
      ({ content: raw } = await vault.read(path));
    } catch (error) {
      if (error instanceof VaultServiceError && error.code === "not_found") {
        return { entries: {}, raw: null };
      }
      throw error;
    }
    const parsed = parseAnnotationStore(raw);
    if (!parsed.ok) {
      throw new AnnotationsError("invalid", `${path}: ${parsed.error}`);
    }
    return { entries: parsed.store, raw };
  };

  const swapStore = async (
    noteId: string,
    base: StoreBase,
    next: AnnotationStore,
  ): Promise<boolean> => {
    const path = annotationsStorePath(noteId);
    const content = serializeAnnotationStore(next);
    const result =
      base.raw === null
        ? await vault.writeGuarded(path, content, { kind: "absent" })
        : await vault.writeIfUnchanged(path, base.raw, content);
    return result.applied;
  };

  // the edit re-runs against the retry's read, so an id the other writer took is refused, not re-applied.
  const commit = async <Applied extends EditApplied>(
    noteId: string,
    edit: (entries: AnnotationStore) => Applied | EditRefused,
    wrote: Wrote,
  ): Promise<Applied> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const base = await readStore(noteId);
      const edited = edit(base.entries);
      if (!edited.ok) {
        throw new AnnotationsError("refused", edited.error);
      }
      if (await swapStore(noteId, base, edited.store)) {
        wrote.add(annotationsStorePath(noteId));
        return edited;
      }
    }
    throw new AnnotationsError(
      "conflict",
      `${annotationsStorePath(noteId)} changed under the edit twice; nothing was written`,
    );
  };

  // the markers spliced around the quote's passage under the note's compare-and-swap, retried once
  // when the note changed; a passage gone or a second change takes the entry back out
  const placeMarkers = async (
    request: {
      id: string;
      key: string;
      path: string;
      place: { occurrence: number };
      quote: string;
    },
    wrote: Wrote,
  ): Promise<NoteRead> => {
    const { id, key, path, place, quote } = request;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await readNote(path);
      const placement = placeQuotes(
        current.content,
        [{ id, occurrence: place.occurrence, quote }],
        {
          final: false,
        },
      );
      if (!placement.placed.includes(id)) {
        await commit(key, (entries) => deleteAnnotation(entries, id), wrote);
        throw new AnnotationsError("passage-not-found", PASSAGE_NOT_FOUND);
      }
      if (placement.content === current.content) {
        return current;
      }
      const written = await vault.writeIfUnchanged(path, current.content, placement.content);
      if (written.applied) {
        wrote.add(path);
        return { content: placement.content, id: current.id };
      }
    }
    await commit(key, (entries) => deleteAnnotation(entries, id), wrote);
    throw new AnnotationsError(
      "conflict",
      `${path} changed under the highlight twice; nothing was written`,
    );
  };

  // the removed ids' markers spliced out of the note under its compare-and-swap, retried once
  const stripFrom = async (
    path: string,
    ids: readonly string[],
    wrote: Wrote,
  ): Promise<NoteRead> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await readNote(path);
      const stripped = stripAnnotationMarkers(current.content, ids);
      if (stripped === current.content) {
        return current;
      }
      const written = await vault.writeIfUnchanged(path, current.content, stripped);
      if (written.applied) {
        wrote.add(path);
        return { content: stripped, id: current.id };
      }
    }
    throw new AnnotationsError(
      "conflict",
      `${path} changed under the removal twice; the highlight is gone but its marks are still in the text`,
    );
  };

  // edit, reply and remove act on an annotation that exists, so a note with no id has none of them
  const keyOfAnnotated = async (notePath: string): Promise<{ note: NoteRead; key: string }> => {
    const note = await readNote(notePath);
    if (note.id === null) {
      throw new AnnotationsError("refused", `${notePath} has no annotations`);
    }
    return { key: keyOf(notePath, note.id), note };
  };

  return {
    async add({ path, id, place, quote, text, source = DEFAULT_SOURCE }) {
      return await tracked(async (wrote) => {
        const note = await readNote(path);
        // a passage the text does not hold is refused before anything is written
        if (place !== undefined && !holdsPassage(note.content, { id, place, quote })) {
          throw new AnnotationsError("passage-not-found", PASSAGE_NOT_FOUND);
        }
        const key = await storeKeyOf(path, note, wrote);
        const added = await commit(
          key,
          (entries) => addRoot(entries, { at: now(), id, quote, source, text }),
          wrote,
        );
        if (place === undefined) {
          return answer(path, note, added.store);
        }
        const placed = await placeMarkers({ id, key, path, place, quote }, wrote);
        return answer(path, placed, added.store);
      });
    },

    async addUnanchored({ itemId, entries }) {
      return await tracked(async (wrote) => {
        const key = keyOf(annotationsStorePath(itemId), itemId);
        await commit(key, (store) => withUnanchored(store, entries), wrote);
        return { path: annotationsStorePath(key) };
      });
    },

    async edit({ path, id, text, source = DEFAULT_SOURCE }) {
      return await tracked(async (wrote) => {
        const { note, key } = await keyOfAnnotated(path);
        const edited = await commit(
          key,
          (entries) => editEntry(entries, { at: now(), id, source, text }),
          wrote,
        );
        return answer(path, note, edited.store);
      });
    },

    async list(path) {
      let note: NoteRead;
      try {
        note = await readNote(path);
      } catch (error) {
        if (error instanceof VaultServiceError && error.code === "not_found") {
          return toResponse(path, foldAnnotations({}, null), {
            onStub: false,
            passages: new Map(),
          });
        }
        throw error;
      }
      if (note.id === null) {
        return answer(path, note, {});
      }
      const { entries } = await readStore(keyOf(path, note.id));
      return answer(path, note, entries);
    },

    async remove({ path, id, stripMarkers }) {
      return await tracked(async (wrote) => {
        const { note, key } = await keyOfAnnotated(path);
        const deleted = await commit(key, (entries) => deleteAnnotation(entries, id), wrote);
        const current = stripMarkers ? await stripFrom(path, deleted.removedIds, wrote) : note;
        return { ...answer(path, current, deleted.store), removedIds: deleted.removedIds };
      });
    },

    async placeWaiting({ content, final, itemId, only }) {
      if (itemId === null || !isNoteIdKey(itemId)) {
        return { content, placed: [] };
      }
      let store: AnnotationStore;
      try {
        ({ entries: store } = await readStore(itemId));
      } catch (error) {
        // a store that does not parse places nothing, and the fill's own write still lands
        if (error instanceof AnnotationsError) {
          return { content, placed: [] };
        }
        throw error;
      }
      const named = only === undefined ? null : new Set(only);
      const pending = waitingQuotes(store, content).filter(
        (root) => named === null || named.has(root.id),
      );
      if (pending.length === 0) {
        return { content, placed: [] };
      }
      const placement = placeQuotes(content, pending, { final });
      return { content: placement.content, placed: [...placement.placed, ...placement.appended] };
    },

    async reply({ path, id, parentId, text, source = DEFAULT_SOURCE }) {
      return await tracked(async (wrote) => {
        const { note, key } = await keyOfAnnotated(path);
        const added = await commit(
          key,
          (entries) => addReply(entries, { at: now(), id, parentId, source, text }),
          wrote,
        );
        return answer(path, note, added.store);
      });
    },
  };
};
