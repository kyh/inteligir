import type { ExtractedLink } from "./link-extract";
import { scanDoc } from "./link-extract";
import { docStem } from "./doc-file";
import { splitLines } from "./source-lines";
import type { ExtractedTask } from "./task-ordinal";

// bump whenever projectDoc's output shape or semantics change; a mismatch wipes and rebuilds, so there is no migration path
export const PROJECTION_VERSION = 10;

const SNIPPET_MAX = 200;

export function clipSnippet(text: string): string {
  return text.length <= SNIPPET_MAX ? text : `${text.slice(0, SNIPPET_MAX - 1)}…`;
}

/** the snippet is captured here so no downstream index has to retain doc bodies */
export type StoredLink = ExtractedLink & { snippet: string };

export type DocProjection = {
  title: string;
  headings: string[];
  links: StoredLink[];
  tags: string[];
  aliases: string[];
  /** read by no query yet; the scan counts them regardless, so persisting costs one json field */
  tasks: ExtractedTask[];
  pinned: boolean;
  noteId: string | null;
};

export function projectDoc(path: string, content: string): DocProjection {
  const scan = scanDoc(content);
  const lines = splitLines(content);
  const links = scan.links.map((link): StoredLink => ({
    ...link,
    snippet: clipSnippet((lines[link.line - 1] ?? "").trim()),
  }));
  return {
    title: scan.title ?? docStem(path),
    headings: scan.headings,
    links,
    tags: scan.tags,
    aliases: scan.aliases,
    tasks: scan.tasks,
    pinned: scan.pinned,
    noteId: scan.noteId,
  };
}
