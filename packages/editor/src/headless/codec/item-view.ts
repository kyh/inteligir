// An item as an agent reads it: the dialect markdown an export writes, with every link to an item
// written `[Title](mention:<id>)` (its live title and its id) and every file the library holds
// written `assets/<sha>`, so what the agent writes back names the same items and files. The
// person's note comes first and the page a fill read after it inside an `article` fence. The
// blocks are written a group at a time (a list with what nests under it, any other block alone),
// so each group's place in the text is the one it was written at, and a group is written once:
// a page stops before the group that would pass its budget, and the note is written without the
// article for an edit to match in.

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { headlessEditor, serializeNote } from "@repo/editor/headless/markdown/markdown-doc";
import { writtenInList } from "@repo/editor/headless/markdown/md-rules";

import { writeBlocks } from "./write-blocks";
import type { WritePorts, WrittenFile } from "./write-blocks";

interface ViewPorts {
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
  // the longest run of colons opening one of its lines, which an article's fence outgrows
  readonly colons: number;
}

interface ViewGroup extends Group {
  readonly text: string;
  // where its text starts in the view
  readonly start: number;
}

interface ItemView {
  readonly markdown: string;
  // in reading order, the note's before the page's
  readonly groups: readonly ViewGroup[];
  // where the note's text ends: at the article's opening line, or with the view
  readonly noteEnd: number;
}

// the note's part of an item's view, the article unwritten
export interface NoteView {
  // the view's text up to where the article opens, or the whole view when it holds none
  readonly text: string;
  readonly groups: readonly ViewGroup[];
}

const COLON_FENCE_RE = /^[\t >]*(?<colons>:{3,})/gmu;

const colonsOf = (text: string): number => {
  let longest = 0;
  for (const match of text.matchAll(COLON_FENCE_RE)) {
    longest = Math.max(longest, match.groups?.colons?.length ?? 0);
  }
  return longest;
};

// the article's fence outgrows every container fence its page holds, as the writer's own fences
// do, since a `:::` inside a `:::article` closes the article
const articleFence = (page: readonly WrittenGroup[]): string => {
  let longest = 2;
  for (const group of page) {
    longest = Math.max(longest, group.colons);
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

// each group as the writer writes it, under one editor
const groupWriter = (ports: ViewPorts): ((group: Group) => WrittenGroup) => {
  const editor = headlessEditor();
  const write: WritePorts = { path: viewFilePath, target: ports.title };
  return (group) => {
    const text = serializeNote(editor, writeBlocks(group.blocks, write)).replace(/\n$/u, "");
    return { ...group, colons: colonsOf(text), text };
  };
};

const writeGroups = (groups: readonly Group[], ports: ViewPorts): WrittenGroup[] =>
  groups.map(groupWriter(ports));

// two blocks stand a blank line apart, as the writer joins a root's children
const BLANK_LINE = "\n\n";

// what closes the note's text: a blank line above the article when one follows, else the newline
// that ends the view; nothing after a note that holds nothing
const noteClosing = (noteWritten: boolean, articleFollows: boolean): string => {
  if (!noteWritten) {
    return "";
  }
  return articleFollows ? BLANK_LINE : "\n";
};

const articleOpening = (fence: string): string => `${fence}article${BLANK_LINE}`;

const articleClosing = (fence: string): string => `${BLANK_LINE}${fence}\n`;

// groups a blank line apart, each where its text starts, `offset` into the view
const joined = (written: readonly WrittenGroup[], offset: number) => {
  let text = "";
  const groups = written.map(({ blocks, section, text: own }, index): ViewGroup => {
    text += index === 0 ? "" : BLANK_LINE;
    const start = offset + text.length;
    text += own;
    return { blocks, section, start, text: own };
  });
  return { groups, text };
};

const joinedLength = (written: readonly WrittenGroup[]): number => {
  let length = BLANK_LINE.length * Math.max(0, written.length - 1);
  for (const group of written) {
    length += group.text.length;
  }
  return length;
};

const bySection = (written: readonly WrittenGroup[]) => ({
  note: written.filter((group) => group.section === "note"),
  page: written.filter((group) => group.section === "article"),
});

const noteLaidOut = (note: readonly WrittenGroup[], articleFollows: boolean): NoteView => {
  const { groups, text } = joined(note, 0);
  return { groups, text: `${text}${noteClosing(text !== "", articleFollows)}` };
};

// groups as the text an agent reads, each where its text starts
const laidOut = (written: readonly WrittenGroup[]): ItemView => {
  const { note, page } = bySection(written);
  const head = noteLaidOut(note, page.length > 0);
  const noteEnd = head.text.length;
  if (page.length === 0) {
    return { groups: head.groups, markdown: head.text, noteEnd };
  }
  const fence = articleFence(page);
  const opening = articleOpening(fence);
  const article = joined(page, noteEnd + opening.length);
  return {
    groups: [...head.groups, ...article.groups],
    markdown: `${head.text}${opening}${article.text}${articleClosing(fence)}`,
    noteEnd,
  };
};

// how long the markdown `laidOut` writes of these groups runs, counted without writing it
const laidOutLength = (written: readonly WrittenGroup[]): number => {
  const { note, page } = bySection(written);
  const noteLength = joinedLength(note);
  const head = noteLength + noteClosing(noteLength > 0, page.length > 0).length;
  if (page.length === 0) {
    return head;
  }
  const fence = articleFence(page);
  return head + articleOpening(fence).length + joinedLength(page) + articleClosing(fence).length;
};

// the item's markdown and where each group of its blocks, in reading order, sits in it
export const itemView = (blocks: readonly BodyBlock[], ports: ViewPorts): ItemView =>
  laidOut(writeGroups(groupsOf(blocks), ports));

// the note's text and groups as the item's view lays them out, writing none of the article
export const noteView = (blocks: readonly BodyBlock[], ports: ViewPorts): NoteView =>
  noteLaidOut(
    writeGroups(sectionGroups(blocks, "note"), ports),
    blocks.some((stored) => stored.section === "article"),
  );

// the article as the item's view writes it after the note: empty when the item holds none
export const articleView = (blocks: readonly BodyBlock[], ports: ViewPorts): string =>
  laidOut(writeGroups(sectionGroups(blocks, "article"), ports)).markdown;

interface PageAsk {
  // the position, in the item's reading order, of the block the page starts at
  readonly from: number;
  // the most blocks it holds
  readonly count: number;
  // the most characters its markdown runs to, which one group alone may pass
  readonly maxChars: number;
}

interface ViewPage {
  readonly markdown: string;
  // the blocks it holds, as positions in the item's reading order
  readonly from: number;
  readonly to: number;
  readonly total: number;
}

// a run of the item's blocks as one page of its view, of whole groups so a list stays whole, and
// only they are written, each once: the page ends before the group that would carry it past its
// budget. A page inside the article carries the section's own lines, so it reads as the page it is
export const viewPage = (
  blocks: readonly BodyBlock[],
  ports: ViewPorts,
  ask: PageAsk,
): ViewPage => {
  const asked = Math.min(Math.max(0, ask.from), blocks.length);
  const until = asked + Math.max(1, ask.count);
  const write = groupWriter(ports);
  const page: WrittenGroup[] = [];
  let first = asked;
  let last = asked;
  let at = 0;
  for (const group of groupsOf(blocks)) {
    if (at >= until) {
      break;
    }
    const end = at + group.blocks.length;
    if (end > asked) {
      const written = write(group);
      if (page.length > 0 && laidOutLength([...page, written]) > ask.maxChars) {
        break;
      }
      first = page.length === 0 ? at : first;
      last = end;
      page.push(written);
    }
    at = end;
  }
  return { from: first, markdown: laidOut(page).markdown, to: last, total: blocks.length };
};
