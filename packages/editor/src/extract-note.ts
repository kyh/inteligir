// The note's bytes are the editor's own serialization of the blocks, so what leaves is what
// the file would have held; their removal and the link that replaces them land in one flush,
// which is one undo step. The created file is not undone: the vault has no transaction, and a
// note that exists is truer than an edit that never happened. So the buffer is touched only
// once the create made a new file and the blocks are still the bytes that file holds.

import { serializeMd } from "@platejs/markdown";
import { KEYS, NodeApi, PathApi } from "platejs";
import type { Path, SlateEditor, TElement } from "platejs";

import { toast } from "@repo/ui/components/sonner";
import { docStem, freeDocPath } from "@repo/notes/knowledge/doc-file";
import { buildResolver, wikiTargetForPath } from "@repo/notes/knowledge/link-resolve";
import { checkNoteName } from "@repo/notes/knowledge/note-name";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import { serializeWikiBody } from "@repo/notes/markdown/remark-wiki-link";

import { getEditorHostIo } from "@repo/editor/host-io";
import { isFrontmatterElement } from "@repo/editor/kits/frontmatter-kit";
import { getLiveEditor, liveEditorPath } from "@repo/editor/live-editor";
import { MD_STRINGIFY } from "@repo/editor/markdown/markdown-doc";

const HEADING_TYPES = new Set<string>([KEYS.h1, KEYS.h2, KEYS.h3, KEYS.h4, KEYS.h5, KEYS.h6]);
const NAME_MAX_CHARS = 80;
const FALLBACK_STEM = "Untitled";
// the listing is a snapshot, so a name it lacks can be taken on disk; past this many names a
// vault is racing the extract, and it stops rather than chase it
const CREATE_ATTEMPTS = 5;

// the first heading among the blocks, else the first line of the first one; a name the vault
// would refuse falls back rather than being sanitized, since the filename is the title
export const extractionStem = (blocks: readonly TElement[]): string => {
  const source = blocks.find((block) => HEADING_TYPES.has(block.type)) ?? blocks[0];
  const line = source === undefined ? "" : (NodeApi.string(source).split("\n")[0] ?? "");
  const candidate = line.slice(0, NAME_MAX_CHARS).trim().replace(/\.+$/u, "").trim();
  const verdict = checkNoteName(candidate);
  return verdict.ok ? verdict.name : FALLBACK_STEM;
};

// the top-level blocks the selection touches: a partly selected list leaves as a whole
export const selectedTopLevelPaths = (editor: SlateEditor): Path[] => {
  const at = editor.selection;
  if (!at) {
    return [];
  }
  return editor.api.blocks({ at, mode: "highest" }).map(([, path]) => path);
};

const blocksAt = (editor: SlateEditor, paths: readonly Path[]): TElement[] =>
  paths.flatMap((path) => {
    const entry = editor.api.node<TElement>(path);
    return entry === undefined ? [] : [entry[0]];
  });

const serializeBlocks = (editor: SlateEditor, blocks: TElement[]): string => {
  const markdown = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY, value: blocks });
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
};

export const extractBlocksMarkdown = (editor: SlateEditor, paths: readonly Path[]): string =>
  serializeBlocks(editor, blocksAt(editor, paths));

// a marker's thread lives in the comment store keyed by this note's id, so the marker would
// leave for a note whose store never heard of it
const carriesCommentMarker = (block: TElement): boolean =>
  [...NodeApi.elements(block)].some(([element]) => element.type === "commentMarker");

const linkParagraph = (editor: SlateEditor, body: string): TElement => ({
  children: [{ text: "" }, { body, children: [{ text: "" }], type: "wikiLink" }, { text: "" }],
  type: editor.getType(KEYS.p),
});

// the new note's name may already be another note's elsewhere in the vault, so the link is
// resolved against the listing it joins; paths alone decide it, since a path beats any alias
const linkBodyFor = (path: string, existing: readonly string[]): string | null =>
  serializeWikiBody({
    target: wikiTargetForPath(path, buildResolver([...existing, path]).resolveWiki),
  });

const createExtractedNote = async (
  dir: string,
  stem: string,
  markdown: string,
  listed: readonly string[],
): Promise<{ readonly path: string; readonly body: string } | null> => {
  const taken = [...listed];
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const planned = freeDocPath(dir, stem, taken);
    const body = linkBodyFor(planned, taken);
    if (body === null) {
      toast.error("No link can name a note in this folder, so nothing was extracted.");
      return null;
    }
    const result = await getEditorHostIo().actions.createNewFileAt(planned, markdown);
    // the session already said why
    if (result.kind === "refused") {
      return null;
    }
    if (result.kind === "created") {
      return { body, path: result.path };
    }
    taken.push(result.path);
  }
  toast.error(`Every name tried for ${stem} was taken meanwhile, so nothing was extracted.`);
  return null;
};

// the path of the note the blocks moved to, or null when they stayed where they were
export const extractBlocksToNote = async (
  editor: SlateEditor,
  paths: readonly Path[],
): Promise<string | null> => {
  const sorted = [...paths]
    .toSorted(PathApi.compare)
    .filter((path) => !isFrontmatterElement(editor.api.node(path)?.[0]));
  const blocks = blocksAt(editor, sorted);
  if (blocks.length === 0) {
    return null;
  }
  if (blocks.some(carriesCommentMarker)) {
    toast.error("A comment's thread can't move to a new note, so nothing was extracted.");
    return null;
  }
  const markdown = serializeBlocks(editor, blocks);
  const notePath = liveEditorPath(editor);
  const listed = getEditorHostIo()
    .linkResolver.getState()
    .targets.map((target) => target.path);
  // typing, a reload or a note switch can move the blocks while the create is in flight
  const refs = sorted.map((path) => editor.api.pathRef(path));
  const created = await createExtractedNote(
    notePath === null ? "" : dirnamePath(notePath),
    extractionStem(blocks),
    markdown,
    listed,
  );
  const current = refs
    .flatMap((ref) => {
      const path = ref.unref();
      return path === null ? [] : [path];
    })
    .toSorted(PathApi.compare);
  if (created === null) {
    return null;
  }
  const [at] = current;
  const unchanged =
    at !== undefined &&
    current.length === refs.length &&
    (notePath === null || getLiveEditor(notePath) === editor) &&
    extractBlocksMarkdown(editor, current) === markdown;
  if (!unchanged) {
    toast.warning(
      `Created ${docStem(created.path)}, but the note changed meanwhile, so the blocks stayed.`,
    );
    return null;
  }
  editor.tf.withoutNormalizing(() => {
    for (const path of current.toReversed()) {
      editor.tf.removeNodes({ at: path });
    }
    editor.tf.insertNodes(linkParagraph(editor, created.body), { at });
  });
  const end = editor.api.end(at);
  if (end !== undefined) {
    editor.tf.select(end);
  }
  editor.tf.focus();
  toast.success(`Extracted to ${docStem(created.path)}`);
  return created.path;
};
