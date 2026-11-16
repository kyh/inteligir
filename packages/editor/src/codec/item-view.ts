// An item as an agent reads it: the dialect markdown an export writes, with every link to an item
// written `[Title](mention:<id>)` (its live title and its id) and every file the library holds
// written `assets/<sha>`, so what the agent writes back names the same items and files. The
// person's note comes first and the page a fill read after it inside an `article` fence. The
// blocks are written a group at a time (a list with what nests under it, any other block alone),
// so each group's place in the text is the one it was written at.

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { headlessEditor, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { writtenInList } from "@repo/editor/markdown/md-rules";

import { writeBlocks } from "./write-blocks";
import type { WritePorts, WrittenFile } from "./write-blocks";

export interface ViewPorts {
  // an item's title as a link to it is written; null when it is gone
  readonly title: (itemId: string) => string | null;
}

// the blocks written together
interface Group {
  readonly blocks: readonly LibraryBlock[];
  readonly section: LibrarySection;
}

interface WrittenGroup extends Group {
  readonly text: string;
}

interface ViewGroup extends WrittenGroup {
  // where its text starts in the view
  readonly start: number;
}

export interface ItemView {
  readonly markdown: string;
  // in reading order, the note's before the page's
  readonly groups: readonly ViewGroup[];
  // where the note's text ends: at the article's opening line, or with the view
  readonly noteEnd: number;
}

const COLON_FENCE_RE = /^[\t >]*(?<colons>:{3,})/gmu;

// the article's fence outgrows every container fence its page holds, as the writer's own fences
// do, since a `:::` inside a `:::article` closes the article
const articleFence = (page: readonly WrittenGroup[]): string => {
  let longest = 2;
  for (const group of page) {
    for (const match of group.text.matchAll(COLON_FENCE_RE)) {
      longest = Math.max(longest, match.groups?.colons?.length ?? 0);
    }
  }
  return ":".repeat(longest + 1);
};

// where the view writes a file the library holds by its bytes
const viewFilePath = (file: WrittenFile): string =>
  file.name === null ? `assets/${file.sha}` : `assets/${file.sha}/${file.name}`;

const VIEW_FILE_RE = /^assets\/(?<sha>[0-9a-f]{64})(?:\/(?<name>[^/]+))?$/u;

// the file an address the view wrote names: its sha, and the name a file block shows
export const viewFileAt = (url: string): { sha: string; name: string | null } | null => {
  const groups = VIEW_FILE_RE.exec(url)?.groups;
  const sha = groups?.sha;
  return sha === undefined ? null : { name: groups?.name ?? null, sha };
};

// a section's blocks as the writer takes them: a run in a list is one node to it, which nests and
// joins its blocks, and nothing it writes reaches past a block outside a list
const sectionGroups = (stored: readonly BodyBlock[], section: LibrarySection): Group[] => {
  const runs: LibraryBlock[][] = [];
  let inList = false;
  for (const { block } of stored.filter((one) => one.section === section)) {
    const listed = writtenInList(block);
    const run = runs.at(-1);
    if (listed && inList && run !== undefined) {
      run.push(block);
    } else {
      runs.push([block]);
    }
    inList = listed;
  }
  return runs.map((blocks) => ({ blocks, section }));
};

const groupsOf = (stored: readonly BodyBlock[]): Group[] => [
  ...sectionGroups(stored, "note"),
  ...sectionGroups(stored, "article"),
];

// two blocks stand a blank line apart, as the writer joins a root's children
const BLANK_LINE = "\n\n";

// groups as the text an agent reads, each where its text starts
const laidOut = (written: readonly WrittenGroup[]): ItemView => {
  const groups: ViewGroup[] = [];
  let markdown = "";
  const place = (section: readonly WrittenGroup[]): void => {
    for (const [index, group] of section.entries()) {
      markdown += index === 0 ? "" : BLANK_LINE;
      groups.push({ ...group, start: markdown.length });
      markdown += group.text;
    }
  };
  const page = written.filter((group) => group.section === "article");
  place(written.filter((group) => group.section === "note"));
  if (page.length === 0) {
    markdown += markdown === "" ? "" : "\n";
    return { groups, markdown, noteEnd: markdown.length };
  }
  markdown += markdown === "" ? "" : BLANK_LINE;
  const noteEnd = markdown.length;
  const fence = articleFence(page);
  markdown += `${fence}article${BLANK_LINE}`;
  place(page);
  return { groups, markdown: `${markdown}${BLANK_LINE}${fence}\n`, noteEnd };
};

const writeView = (groups: readonly Group[], ports: ViewPorts): ItemView => {
  const editor = headlessEditor();
  const write: WritePorts = { path: viewFilePath, target: ports.title };
  return laidOut(
    groups.map((group) => ({
      ...group,
      text: serializeNote(editor, writeBlocks(group.blocks, write)).replace(/\n$/u, ""),
    })),
  );
};

// the item's markdown and where each group of its blocks, in reading order, sits in it
export const itemView = (blocks: readonly BodyBlock[], ports: ViewPorts): ItemView =>
  writeView(groupsOf(blocks), ports);

export interface ViewPage {
  readonly markdown: string;
  // the blocks it holds, as positions in the item's reading order
  readonly from: number;
  readonly to: number;
  readonly total: number;
}

// a run of the item's blocks as one page of its view, of whole groups so a list stays whole, and
// only they are written; a page inside the article carries the section's own lines, so it reads
// as the page it is
export const viewPage = (
  blocks: readonly BodyBlock[],
  ports: ViewPorts,
  from: number,
  count: number,
): ViewPage => {
  const asked = Math.min(Math.max(0, from), blocks.length);
  const page: Group[] = [];
  let first = asked;
  let last = asked;
  let at = 0;
  for (const group of groupsOf(blocks)) {
    const end = at + group.blocks.length;
    if (end > asked && at < asked + Math.max(1, count)) {
      first = page.length === 0 ? at : first;
      last = end;
      page.push(group);
    }
    at = end;
  }
  return { from: first, markdown: writeView(page, ports).markdown, to: last, total: blocks.length };
};
