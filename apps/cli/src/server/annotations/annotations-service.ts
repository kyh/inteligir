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
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import type {
  AnnotationEntryWire,
  AnnotationsAddRequest,
  AnnotationsEditRequest,
  AnnotationsRemoveRequest,
  AnnotationsRemoveResponse,
  AnnotationsReplyRequest,
  AnnotationsResponse,
} from "@repo/contract/local/annotations/annotations-schema";
import { ANNOTATIONS_MAX } from "@repo/contract/local/annotations/annotations-schema";

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
  | "invalid";

export class AnnotationsError extends Error {
  readonly code: AnnotationsErrorCode;

  constructor(code: AnnotationsErrorCode, message: string) {
    super(message);
    this.name = "AnnotationsError";
    this.code = code;
  }
}

// unix seconds, the store's unit.
export type AnnotationsClock = () => number;

// a call's answer and every vault path it wrote on the way (the store, a note it minted an id
// into), so an agent's turn can commit what its shell caused.
export interface AnnotationsWrite<T> {
  answer: T;
  wrote: string[];
}

export interface AnnotationsService {
  list: (path: string) => Promise<AnnotationsResponse>;
  add: (args: AnnotationsAddRequest) => Promise<AnnotationsWrite<AnnotationsResponse>>;
  edit: (args: AnnotationsEditRequest) => Promise<AnnotationsWrite<AnnotationsResponse>>;
  reply: (args: AnnotationsReplyRequest) => Promise<AnnotationsWrite<AnnotationsResponse>>;
  remove: (args: AnnotationsRemoveRequest) => Promise<AnnotationsWrite<AnnotationsRemoveResponse>>;
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

const toResponse = (path: string, folded: AnnotationFold): AnnotationsResponse => ({
  orphanMarkers: folded.orphanMarkers,
  path,
  strayIds: folded.strayIds,
  annotations: folded.annotations.slice(0, ANNOTATIONS_MAX).map((annotation) => ({
    anchored: annotation.anchored,
    id: annotation.id,
    replies: annotation.replies.map((reply) => ({ entry: toWire(reply.entry), id: reply.id })),
    root: toWire(annotation.root),
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
  toResponse(notePath, foldAnnotations(entries, markerRootIds(note.content)));

// the paths one call wrote, gathered as each write lands.
type Wrote = Set<string>;

const tracked = async <T>(work: (wrote: Wrote) => Promise<T>): Promise<AnnotationsWrite<T>> => {
  const wrote: Wrote = new Set();
  const result = await work(wrote);
  return { answer: result, wrote: [...wrote] };
};

export const createAnnotationsService = (
  vault: VaultService,
  now: AnnotationsClock,
): AnnotationsService => {
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

  // edit, reply and remove act on an annotation that exists, so a note with no id has none of them
  const keyOfAnnotated = async (notePath: string): Promise<{ note: NoteRead; key: string }> => {
    const note = await readNote(notePath);
    if (note.id === null) {
      throw new AnnotationsError("refused", `${notePath} has no annotations`);
    }
    return { key: keyOf(notePath, note.id), note };
  };

  return {
    async add({ path, id, quote, text, source = DEFAULT_SOURCE }) {
      return await tracked(async (wrote) => {
        const note = await readNote(path);
        const key = await storeKeyOf(path, note, wrote);
        const added = await commit(
          key,
          (entries) => addRoot(entries, { at: now(), id, quote, source, text }),
          wrote,
        );
        return answer(path, note, added.store);
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
          return toResponse(path, foldAnnotations({}, null));
        }
        throw error;
      }
      if (note.id === null) {
        return answer(path, note, {});
      }
      const { entries } = await readStore(keyOf(path, note.id));
      return answer(path, note, entries);
    },

    async remove({ path, id }) {
      return await tracked(async (wrote) => {
        const { note, key } = await keyOfAnnotated(path);
        const deleted = await commit(key, (entries) => deleteAnnotation(entries, id), wrote);
        return { ...answer(path, note, deleted.store), removedIds: deleted.removedIds };
      });
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
