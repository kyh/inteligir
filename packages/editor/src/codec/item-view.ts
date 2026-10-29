// An item as an agent reads it: the dialect markdown an export writes, with every link to an item
// written `[[Title|uuid]]` (its live title, its id after the last pipe) and every file the library
// holds written `assets/<sha>`, so what the agent writes back names the same items and files. The
// person's note comes first and the page a fill read after it inside `:::article`. Each block
// knows where it sits in the text, so an edit maps back to the blocks it touched; a run of list
// items is written as one list, so its items share one place.

import type { TElement } from "platejs";

import type { StoredBlock } from "@repo/notes/library/block-ops";
import { orderedBlocks } from "@repo/notes/library/block-ops";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";
import type { FlowSpan } from "@repo/notes/markdown/flow-spans";

import { headlessEditor, serializeNoteSpans } from "@repo/editor/markdown/markdown-doc";

import { writeBlocks } from "./write-blocks";
import type { WritePorts, WrittenFile } from "./write-blocks";

export interface ViewPorts {
  // an item's title as a link to it is written; null when it is gone
  readonly title: (itemId: string) => string | null;
}

// one block's place in the view: its own, or the list it is an item of
export interface ViewBlock {
  readonly block: LibraryBlock;
  readonly hash: string;
  readonly ord: string;
  readonly section: LibrarySection;
  // the run of blocks it is written with, numbered from the view's first
  readonly group: number;
  readonly start: number;
  readonly end: number;
}

export interface ItemView {
  readonly markdown: string;
  readonly blocks: readonly ViewBlock[];
  // the lines that open and close the article section, when the item has one
  readonly article: { readonly open: FlowSpan; readonly close: FlowSpan } | null;
}

const ARTICLE_OPEN = ":::article";
const ARTICLE_CLOSE = ":::";

// where the view writes a file the library holds by its bytes
const viewFilePath = (file: WrittenFile): string =>
  file.name === null ? `assets/${file.sha}` : `assets/${file.sha}/${file.name}`;

const VIEW_FILE_RE = /^assets\/(?<sha>[0-9a-f]{64})(?:\/(?<name>[^/]+))?$/u;

// the file an address the view wrote names: its sha, and the name a file block shows
export const viewFileAt = (url: string): { sha: string; name: string | null } | null => {
  const groups = VIEW_FILE_RE.exec(url)?.groups;
  const sha = groups?.["sha"];
  return sha === undefined ? null : { name: groups?.["name"] ?? null, sha };
};

const isListItem = (element: TElement): boolean =>
  element.type === "p" && element["listStyleType"] !== undefined;

// the runs the rule table writes as one top-level node: each list run, as Plate's serializer
// groups one (a run ends where the next item is no list item, or starts a list of another style
// at the run's own depth), and every other element alone
const runsOf = (elements: readonly TElement[]): number[][] => {
  const runs: number[][] = [];
  let run: number[] = [];
  for (const [index, element] of elements.entries()) {
    if (!isListItem(element)) {
      runs.push([index]);
      continue;
    }
    run.push(index);
    const next = elements[index + 1];
    const first = elements[run[0] ?? index];
    const continues =
      next !== undefined &&
      isListItem(next) &&
      !(next["listStyleType"] !== first?.["listStyleType"] && next["indent"] === first?.["indent"]);
    if (!continues) {
      runs.push(run);
      run = [];
    }
  }
  return runs;
};

interface WrittenSection {
  readonly markdown: string;
  // per stored block, its group's span in the section's text and the group's number
  readonly places: readonly { readonly group: number; readonly span: FlowSpan }[];
  readonly groups: number;
}

const writeSection = (blocks: readonly StoredBlock[], ports: WritePorts): WrittenSection => {
  const elements: TElement[] = [];
  const owners: number[] = [];
  for (const [index, stored] of blocks.entries()) {
    const written = writeBlocks([stored.block], ports);
    elements.push(...written);
    owners.push(...written.map(() => index));
  }
  if (elements.length === 0) {
    return { groups: 0, markdown: "", places: [] };
  }
  const { markdown, spans } = serializeNoteSpans(headlessEditor(), elements);
  const text = markdown.replace(/\n$/u, "");
  const runs = runsOf(elements);
  // a node the rules wrote nothing for (or two for one) leaves the runs uncounted: the section is
  // then one run, which an edit re-reads whole
  const whole: FlowSpan = { end: text.length, start: 0 };
  const counted = runs.length === spans.length;
  const groupOf = new Map<number, number>();
  for (const [group, run] of runs.entries()) {
    for (const element of run) {
      groupOf.set(owners[element] ?? -1, counted ? group : 0);
    }
  }
  const places = blocks.map((_, index) => {
    const group = groupOf.get(index) ?? 0;
    return { group, span: counted ? (spans[group] ?? whole) : whole };
  });
  return { groups: counted ? runs.length : 1, markdown: text, places };
};

// a section's blocks at their places in the whole view
const placed = (
  stored: readonly StoredBlock[],
  section: WrittenSection,
  offset: number,
  firstGroup: number,
): ViewBlock[] =>
  stored.map((one, index) => {
    const place = section.places[index] ?? { group: 0, span: { end: 0, start: 0 } };
    return {
      ...one,
      end: offset + place.span.end,
      group: firstGroup + place.group,
      start: offset + place.span.start,
    };
  });

const viewPorts = (ports: ViewPorts): WritePorts => ({
  path: viewFilePath,
  target: ports.title,
  withIds: true,
});

// the item's markdown and where each of its blocks sits in it
export const itemView = (blocks: ReadonlyMap<string, StoredBlock>, ports: ViewPorts): ItemView => {
  const ordered = orderedBlocks(blocks);
  const write = viewPorts(ports);
  const notes = ordered.filter((stored) => stored.section === "note");
  const pages = ordered.filter((stored) => stored.section === "article");
  const note = writeSection(notes, write);
  const page = writeSection(pages, write);
  if (pages.length === 0) {
    return { article: null, blocks: placed(notes, note, 0, 0), markdown: `${note.markdown}\n` };
  }
  const lead = note.markdown === "" ? "" : `${note.markdown}\n\n`;
  const open: FlowSpan = { end: lead.length + ARTICLE_OPEN.length, start: lead.length };
  const pageStart = open.end + 2;
  const close: FlowSpan = {
    end: pageStart + page.markdown.length + 2 + ARTICLE_CLOSE.length,
    start: pageStart + page.markdown.length + 2,
  };
  return {
    article: { close, open },
    blocks: [...placed(notes, note, 0, 0), ...placed(pages, page, pageStart, note.groups)],
    markdown: `${lead}${ARTICLE_OPEN}\n\n${page.markdown}\n\n${ARTICLE_CLOSE}\n`,
  };
};

export interface ViewPage {
  readonly markdown: string;
  // the blocks it holds, as positions in the item's reading order
  readonly from: number;
  readonly to: number;
  readonly total: number;
}

// a run of the item's blocks as one page of its view, cut where a group starts and ends so a list
// stays whole; a page inside the article carries the section's own lines, so it reads as the
// page it is
export const viewPage = (view: ItemView, from: number, count: number): ViewPage => {
  const { blocks } = view;
  const total = blocks.length;
  let first = Math.min(Math.max(0, from), total);
  while (first > 0 && first < total && blocks[first - 1]?.group === blocks[first]?.group) {
    first -= 1;
  }
  let last = Math.min(total, first + Math.max(1, count));
  while (last < total && blocks[last]?.group === blocks[last - 1]?.group) {
    last += 1;
  }
  const head = blocks[first];
  const tail = blocks[last - 1];
  if (head === undefined || tail === undefined) {
    return { from: first, markdown: "", to: first, total };
  }
  const text = view.markdown.slice(head.start, tail.end);
  const opens = head.section === "article" ? `${ARTICLE_OPEN}\n\n` : "";
  const closes = tail.section === "article" ? `\n\n${ARTICLE_CLOSE}` : "";
  const crosses = head.section === "note" && tail.section === "article";
  const markdown = crosses
    ? view.markdown.slice(head.start, tail.end) + closes
    : `${opens}${text}${closes}`;
  return { from: first, markdown: `${markdown}\n`, to: last, total };
};
