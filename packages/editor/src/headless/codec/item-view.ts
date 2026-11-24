import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { headlessEditor, serializeNote } from "@repo/editor/headless/codec/markdown-doc";
import { writtenInList } from "@repo/editor/headless/markdown/md-rules";

import { writeBlocks } from "./write-blocks";
import type { WritePorts, WrittenFile } from "./write-blocks";

interface ViewPorts {
  readonly title: (itemId: string) => string | null;
}

interface Group {
  readonly blocks: readonly LibraryBlock[];
  readonly section: LibrarySection;
}

interface WrittenGroup extends Group {
  readonly text: string;
  readonly colons: number;
}

interface ViewGroup extends Group {
  readonly text: string;
  readonly start: number;
}

interface ItemView {
  readonly markdown: string;
  readonly groups: readonly ViewGroup[];
  readonly noteEnd: number;
}

export interface NoteView {
  readonly text: string;
  readonly groups: readonly ViewGroup[];
}

const COLON_FENCE_RE = /^[\t >]*(?<colons>:{3,})/gmu;

const colonsOf = (text: string) => {
  let longest = 0;

  for (const match of text.matchAll(COLON_FENCE_RE)) {
    longest = Math.max(longest, match.groups?.colons?.length ?? 0);
  }

  return longest;
};

const articleFence = (page: readonly WrittenGroup[]) => {
  let longest = 2;

  for (const group of page) {
    longest = Math.max(longest, group.colons);
  }

  return ":".repeat(longest + 1);
};

const viewFilePath = (file: WrittenFile) =>
  file.name === null ? `assets/${file.sha}` : `assets/${file.sha}/${file.name}`;

const VIEW_FILE_RE = /^assets\/(?<sha>[0-9a-f]{64})(?:\/(?<name>[^/]+))?$/u;

export const viewFileAt = (url: string) => {
  const groups = VIEW_FILE_RE.exec(url)?.groups;
  const sha = groups?.sha;

  return (sha === undefined ? null : { name: groups?.name ?? null, sha }) satisfies {
    sha: string;
    name: string | null;
  } | null;
};

const sectionGroups = (stored: readonly BodyBlock[], section: LibrarySection) => {
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

const groupsOf = (stored: readonly BodyBlock[]) =>
  [...sectionGroups(stored, "note"), ...sectionGroups(stored, "article")] satisfies Group[];

const groupWriter = (ports: ViewPorts) => {
  const editor = headlessEditor();
  const write: WritePorts = { path: viewFilePath, target: ports.title };

  return ((group) => {
    const text = serializeNote(editor, writeBlocks(group.blocks, write)).replace(/\n$/u, "");

    return { ...group, colons: colonsOf(text), text };
  }) satisfies (group: Group) => WrittenGroup;
};

const writeGroups = (groups: readonly Group[], ports: ViewPorts) => groups.map(groupWriter(ports));

const BLANK_LINE = "\n\n";

const noteClosing = (noteWritten: boolean, articleFollows: boolean) => {
  if (!noteWritten) {
    return "";
  }

  return articleFollows ? BLANK_LINE : "\n";
};

const articleOpening = (fence: string) => `${fence}article${BLANK_LINE}`;

const articleClosing = (fence: string) => `${BLANK_LINE}${fence}\n`;

const joined = (written: readonly WrittenGroup[], offset: number) => {
  let text = "";

  const groups = written.map(({ blocks, section, text: own }, index) => {
    text += index === 0 ? "" : BLANK_LINE;
    const start = offset + text.length;
    text += own;

    return { blocks, section, start, text: own } satisfies ViewGroup;
  });

  return { groups, text };
};

const joinedLength = (written: readonly WrittenGroup[]) => {
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

const noteLaidOut = (note: readonly WrittenGroup[], articleFollows: boolean) => {
  const { groups, text } = joined(note, 0);

  return { groups, text: `${text}${noteClosing(text !== "", articleFollows)}` } satisfies NoteView;
};

const laidOut = (written: readonly WrittenGroup[]) => {
  const { note, page } = bySection(written);
  const head = noteLaidOut(note, page.length > 0);
  const noteEnd = head.text.length;

  if (page.length === 0) {
    return { groups: head.groups, markdown: head.text, noteEnd } satisfies ItemView;
  }

  const fence = articleFence(page);
  const opening = articleOpening(fence);
  const article = joined(page, noteEnd + opening.length);

  return {
    groups: [...head.groups, ...article.groups],
    markdown: `${head.text}${opening}${article.text}${articleClosing(fence)}`,
    noteEnd,
  } satisfies ItemView;
};

const laidOutLength = (written: readonly WrittenGroup[]) => {
  const { note, page } = bySection(written);
  const noteLength = joinedLength(note);
  const head = noteLength + noteClosing(noteLength > 0, page.length > 0).length;

  if (page.length === 0) {
    return head;
  }

  const fence = articleFence(page);

  return head + articleOpening(fence).length + joinedLength(page) + articleClosing(fence).length;
};

export const itemView = (blocks: readonly BodyBlock[], ports: ViewPorts) =>
  laidOut(writeGroups(groupsOf(blocks), ports));

export const noteView = (blocks: readonly BodyBlock[], ports: ViewPorts) =>
  noteLaidOut(
    writeGroups(sectionGroups(blocks, "note"), ports),
    blocks.some((stored) => stored.section === "article"),
  );

export const articleView = (blocks: readonly BodyBlock[], ports: ViewPorts) =>
  laidOut(writeGroups(sectionGroups(blocks, "article"), ports)).markdown;

interface PageAsk {
  readonly from: number;
  readonly count: number;
  readonly maxChars: number;
}

interface ViewPage {
  readonly markdown: string;
  readonly from: number;
  readonly to: number;
  readonly total: number;
}

export const viewPage = (blocks: readonly BodyBlock[], ports: ViewPorts, ask: PageAsk) => {
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

  return {
    from: first,
    markdown: laidOut(page).markdown,
    to: last,
    total: blocks.length,
  } satisfies ViewPage;
};
