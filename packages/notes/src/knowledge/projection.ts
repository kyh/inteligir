import type { ItemFacts } from "../items/item-frontmatter";
import { splitLines } from "../text/source-lines";
import type { ExtractedLink } from "./link-extract";
import { scanDoc } from "./link-extract";
import { docStem } from "./doc-file";

// bump whenever projectDoc's output shape or semantics change, or it would now take a doc it
// threw on (the store keeps that doc's hash, so nothing else retries it); a mismatch wipes and
// rebuilds, so there is no migration path
export const PROJECTION_VERSION = 13;

const SNIPPET_MAX = 200;

// a card's preview: the first paragraph's text, cut short
const PREVIEW_MAX = 140;

export const clipSnippet = (text: string, max: number = SNIPPET_MAX): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** the snippet is captured here so no downstream index has to retain doc bodies */
export type StoredLink = ExtractedLink & { snippet: string };

export interface DocProjection {
  title: string;
  headings: string[];
  links: StoredLink[];
  tags: string[];
  aliases: string[];
  pinned: boolean;
  noteId: string | null;
  // the item its frontmatter says it is; a note's are NOTE_FACTS
  item: ItemFacts;
  // the first paragraph's text, at most PREVIEW_MAX; "" when none holds any
  preview: string;
}

export const projectDoc = (path: string, content: string): DocProjection => {
  const scan = scanDoc(content);
  const lines = splitLines(content);
  const links = scan.links.map((link): StoredLink => ({
    ...link,
    snippet: clipSnippet((lines[link.line - 1] ?? "").trim()),
  }));
  const { description } = scan.item;
  return {
    aliases: scan.aliases,
    headings: scan.headings,
    item: { ...scan.item, description: description === null ? null : clipSnippet(description) },
    links,
    noteId: scan.noteId,
    pinned: scan.pinned,
    preview: scan.preview === null ? "" : clipSnippet(scan.preview, PREVIEW_MAX),
    tags: scan.tags,
    title: scan.title ?? docStem(path),
  };
};
