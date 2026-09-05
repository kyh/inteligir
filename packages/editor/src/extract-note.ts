// The note's bytes are the editor's own serialization of the blocks, so what leaves is what
// the file would have held; their removal and the link that replaces them land in one flush,
// which is one undo step. The created file is not undone: the vault has no transaction, and a
// note that exists is truer than an edit that never happened.

import { serializeMd } from "@platejs/markdown";
import { KEYS, NodeApi, PathApi, type Path, type SlateEditor, type TElement } from "platejs";

import { toast } from "@repo/ui/components/sonner";
import { DEFAULT_DOC_EXTENSION, docStem } from "@repo/notes/knowledge/doc-file";
import { checkNoteName } from "@repo/notes/knowledge/note-name";
import { dirnamePath, joinPath } from "@repo/notes/knowledge/vault-path";

import { getEditorHostIo } from "@repo/editor/host-io";
import { liveEditorPath } from "@repo/editor/live-editor";
import { MD_STRINGIFY } from "@repo/editor/markdown/markdown-doc";

const HEADING_TYPES = new Set<string>([KEYS.h1, KEYS.h2, KEYS.h3, KEYS.h4, KEYS.h5, KEYS.h6]);
const NAME_MAX_CHARS = 80;
const FALLBACK_STEM = "Untitled";

// the first heading among the blocks, else the first line of the first one; a name the vault
// would refuse falls back rather than being sanitized, since the filename is the title
export function extractionStem(blocks: readonly TElement[]): string {
  const source = blocks.find((block) => HEADING_TYPES.has(block.type)) ?? blocks[0];
  const line = source === undefined ? "" : (NodeApi.string(source).split("\n")[0] ?? "");
  const candidate = line.slice(0, NAME_MAX_CHARS).trim().replace(/\.+$/u, "").trim();
  const verdict = checkNoteName(candidate);
  return verdict.ok ? verdict.name : FALLBACK_STEM;
}

// the rail's Untitled rule: lowercased, because the disk may be case-insensitive
export function extractionPath(dir: string, stem: string, existingPaths: Iterable<string>): string {
  const taken = new Set([...existingPaths].map((path) => path.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const name = `${n === 1 ? stem : `${stem} ${String(n)}`}${DEFAULT_DOC_EXTENSION}`;
    const path = joinPath(dir, name);
    if (!taken.has(path.toLowerCase())) return path;
  }
}

// the top-level blocks the selection touches: a partly selected list leaves as a whole
export function selectedTopLevelPaths(editor: SlateEditor): Path[] {
  const at = editor.selection;
  if (!at) return [];
  return editor.api.blocks({ at, mode: "highest" }).map(([, path]) => path);
}

function blocksAt(editor: SlateEditor, paths: readonly Path[]): TElement[] {
  return paths.flatMap((path) => {
    const entry = editor.api.node<TElement>(path);
    return entry === undefined ? [] : [entry[0]];
  });
}

export function extractBlocksMarkdown(editor: SlateEditor, paths: readonly Path[]): string {
  const markdown = serializeMd(editor, {
    value: blocksAt(editor, paths),
    remarkStringifyOptions: MD_STRINGIFY,
  });
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

function linkParagraph(editor: SlateEditor, stem: string): TElement {
  return {
    type: editor.getType(KEYS.p),
    children: [
      { text: "" },
      { type: "wikiLink", body: stem, children: [{ text: "" }] },
      { text: "" },
    ],
  };
}

export async function extractBlocksToNote(
  editor: SlateEditor,
  paths: readonly Path[],
): Promise<string | null> {
  const sorted = [...paths].toSorted(PathApi.compare);
  const first = sorted[0];
  if (first === undefined) return null;
  const markdown = extractBlocksMarkdown(editor, sorted);
  const host = getEditorHostIo();
  const notePath = liveEditorPath(editor);
  const dir = notePath === null ? "" : dirnamePath(notePath);
  const stem = extractionStem(blocksAt(editor, sorted));
  const existing = (await host.listWikiTargets()).map((target) => target.path);
  const created = await host.actions.createFileAt(extractionPath(dir, stem, existing), markdown);
  // the session already said why
  if (created === null) return null;
  editor.tf.withoutNormalizing(() => {
    for (const path of sorted.toReversed()) editor.tf.removeNodes({ at: path });
    editor.tf.insertNodes(linkParagraph(editor, docStem(created)), { at: first });
  });
  const end = editor.api.end(first);
  if (end !== undefined) editor.tf.select(end);
  editor.tf.focus();
  toast.success(`Extracted to ${docStem(created)}`);
  return created;
}
