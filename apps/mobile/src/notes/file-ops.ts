// The phone's file verbs over the notes store, each planned with the rule the server runs, so a
// note made, renamed or deleted here is the one the Mac would have made: a new note steps past a
// taken name, a rename rewrites the links naming the note and keeps its old name as an alias in
// the same change set, a delete takes the note's comment store unless another note carries its id,
// and a photo lands under a free name in the attachments folder. Platform-free: the scenario suite
// runs it under node.

import {
  VAULT_COMMIT_MAX_BYTES,
  VAULT_COMMIT_MAX_CHANGES,
} from "@repo/api/cloud/vault/vault-commit-schema";
import {
  assetMediaType,
  VAULT_ASSET_MAX_BYTES,
  VAULT_FILE_MAX_BYTES,
} from "@repo/api/cloud/vault/vault-schema";
import { utf8ByteLength } from "@repo/api/cloud/bytes";
import { commentStoresFreedBy } from "@repo/notes/comments/store-removal";
import { freeAssetPath } from "@repo/notes/knowledge/asset-name";
import {
  docExtension,
  docStem,
  DEFAULT_DOC_EXTENSION,
  freeDocPath,
  isDocPath,
} from "@repo/notes/knowledge/doc-file";
import { LinkGraphIndex, resolverEntriesOf } from "@repo/notes/knowledge/link-graph-index";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { movesOf, renameAlias, renameWrites } from "@repo/notes/knowledge/plan-rename";
import type { RenameSource } from "@repo/notes/knowledge/plan-rename";
import { projectDoc } from "@repo/notes/knowledge/projection";
import { moveCandidates } from "@repo/notes/knowledge/rename-candidates";
import { computeMoveEdits } from "@repo/notes/knowledge/rename-links";
import { dirnamePath, joinPath } from "@repo/notes/knowledge/vault-path";
import { addFrontmatterAlias } from "@repo/notes/markdown/frontmatter";
import { DEFAULT_ATTACHMENTS_FOLDER } from "@repo/notes/templates/placeholders";
import type { HeldFile, NotesStore, RenameEdits } from "./notes-store";

export type FileOpsStore = Pick<
  NotesStore,
  "create" | "heldFiles" | "noteTexts" | "putAsset" | "remove" | "rename"
>;

export type CreatedNote = { kind: "created"; path: string } | { kind: "refused"; message: string };

// `unlinked`: notes whose links still say the old name, which the note's alias answers
export type RenamedNote =
  | { kind: "renamed"; path: string; unlinked: readonly string[] }
  | { kind: "refused"; message: string };

type WrittenAsset = { kind: "written"; path: string } | { kind: "refused"; message: string };

export interface FileOps {
  // an empty note named Untitled in `dir`, or the first free Untitled beside it
  create: (dir: string) => Promise<CreatedNote>;
  // `name` is the title as typed, refused rather than cleaned up: a title is what the file is called
  rename: (from: string, name: string) => Promise<RenamedNote>;
  remove: (path: string) => Promise<void>;
  writeAsset: (baseName: string, bytes: Uint8Array) => Promise<WrittenAsset>;
}

const UNTITLED = "Untitled";

// another write can take the picked name between the pick and the queue; past this the name
// keeps being taken, which is a fault rather than a race
const MAX_NAME_ATTEMPTS = 3;

// the move and the note's own write
const RENAME_OWN_CHANGES = 2;

// a set crosses as json, which can double a note's bytes in escapes, so its texts fill half the body
const RENAME_TEXT_BUDGET_BYTES = VAULT_COMMIT_MAX_BYTES / 2;

const NAME_TAKEN = "That name kept being taken. Try again.";

// every note the phone lists, its links read from the text it holds; a note whose text has not
// downloaded still answers by its path, aliases and id, and links nowhere
const linkGraphOf = (
  files: readonly HeldFile[],
  texts: ReadonlyMap<string, string>,
): LinkGraphIndex => {
  const graph = new LinkGraphIndex();
  for (const file of files) {
    if (!isDocPath(file.path)) {
      graph.setOther(file.path);
      continue;
    }
    const text = texts.get(file.path);
    graph.applyDoc(
      file.path,
      text === undefined
        ? {
            aliases: [...file.aliases],
            headings: [],
            links: [],
            noteId: file.noteId,
            pinned: false,
            tags: [],
            title: docStem(file.path),
          }
        : projectDoc(file.path, text),
    );
  }
  return graph;
};

// a typed title keeps the note's own extension; a typed doc extension is taken as written
const renamedPath = (from: string, name: string): string =>
  joinPath(
    dirnamePath(from),
    isDocPath(name) ? name : `${name}${docExtension(from) || DEFAULT_DOC_EXTENSION}`,
  );

type PlannedRewrite = RenameEdits["rewrites"][number];

interface PlannedRename {
  edits: RenameEdits;
  // rewrites one change set cannot carry; the alias answers their links
  unplanned: readonly string[];
}

const planRename = async (
  store: FileOpsStore,
  from: string,
  to: string,
): Promise<PlannedRename> => {
  const files = store.heldFiles();
  const texts = await store.noteTexts();
  const graph = linkGraphOf(files, texts);
  const allFiles = files.map((file) => file.path);
  const source: RenameSource = { kind: "file", path: from };
  const moves = movesOf(source, allFiles, to);
  const docs = new Map(
    moveCandidates(graph, moves).flatMap((path): [string, string][] => {
      const text = texts.get(path);
      return text === undefined ? [] : [[path, text]];
    }),
  );
  const { aliasEntries, idEntries } = resolverEntriesOf(graph.wikiTargets());
  const edits = computeMoveEdits({ aliasEntries, allFiles, docs, idEntries, moves });
  const alias = renameAlias(source, to);
  const writes = renameWrites({ alias, edits, moves, renamed: to });

  const own = writes.find((write) => write.renamedNote);
  const sourceText = texts.get(from);
  let note: RenameEdits["note"] = null;
  if (own !== undefined && sourceText !== undefined) {
    note = { content: own.content, expected: sourceText };
  } else if (alias !== null && sourceText !== undefined) {
    const withAlias = addFrontmatterAlias(sourceText, alias);
    note = withAlias === null ? null : { content: withAlias, expected: sourceText };
  }

  let bytes = note === null ? 0 : utf8ByteLength(note.content);
  const rewrites: PlannedRewrite[] = [];
  const unplanned: string[] = [];
  for (const write of writes) {
    const expected = docs.get(write.from);
    if (write.renamedNote || expected === undefined) {
      continue;
    }
    const size = utf8ByteLength(write.content);
    if (
      rewrites.length + RENAME_OWN_CHANGES >= VAULT_COMMIT_MAX_CHANGES ||
      size > VAULT_FILE_MAX_BYTES ||
      bytes + size > RENAME_TEXT_BUDGET_BYTES
    ) {
      unplanned.push(write.path);
      continue;
    }
    bytes += size;
    rewrites.push({ content: write.content, expected, path: write.path });
  }
  return { edits: { note, rewrites }, unplanned };
};

export const createFileOps = (store: FileOpsStore): FileOps => ({
  async create(dir) {
    const refused: string[] = [];
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      const taken = [...store.heldFiles().map((file) => file.path), ...refused];
      const path = freeDocPath(dir, UNTITLED, taken);
      const outcome = await store.create(path, "");
      if (outcome.kind === "created") {
        return { kind: "created", path };
      }
      refused.push(path);
    }
    return { kind: "refused", message: NAME_TAKEN };
  },

  async remove(path) {
    const files = store.heldFiles();
    const noteId = files.find((file) => file.path === path)?.noteId ?? null;
    const stores = commentStoresFreedBy([{ noteId, path }], (id) =>
      files.filter((file) => file.noteId === id).map((file) => file.path),
    );
    await store.remove(path, stores);
  },

  async rename(from, name) {
    const verdict = checkNoteName(name);
    if (!verdict.ok) {
      return { kind: "refused", message: noteNameErrorMessage(verdict.reason) };
    }
    const to = renamedPath(from, verdict.name);
    if (to === from) {
      return { kind: "renamed", path: from, unlinked: [] };
    }
    const planned = await planRename(store, from, to);
    const outcome = await store.rename(from, to, planned.edits);
    switch (outcome.kind) {
      case "renamed": {
        return { kind: "renamed", path: to, unlinked: [...planned.unplanned, ...outcome.skipped] };
      }
      case "exists": {
        return { kind: "refused", message: `A note named ${docStem(to)} is already here.` };
      }
      case "vanished": {
        return { kind: "refused", message: "This note is no longer on your phone." };
      }
      // no default
    }
  },

  async writeAsset(baseName, bytes) {
    if (bytes.length > VAULT_ASSET_MAX_BYTES) {
      return { kind: "refused", message: "This file is too large to add from your phone." };
    }
    const refused: string[] = [];
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      const taken = [...store.heldFiles().map((file) => file.path), ...refused];
      const path = freeAssetPath(DEFAULT_ATTACHMENTS_FOLDER, baseName, taken);
      if (assetMediaType(path) === null) {
        return { kind: "refused", message: "Your vault cannot hold this kind of file." };
      }
      const outcome = await store.putAsset(path, bytes);
      if (outcome.kind === "created") {
        return { kind: "written", path };
      }
      refused.push(path);
    }
    return { kind: "refused", message: NAME_TAKEN };
  },
});
