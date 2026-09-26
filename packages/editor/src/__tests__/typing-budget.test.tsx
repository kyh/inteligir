// What typing costs in a long note, held to a budget recorded from a baseline. One block near the
// note's end keeps the stack of every read of it, and only a pass over the whole note reaches it:
// so a pass is found rather than declared, and one that stops early, or a cache keyed by the
// top-level block, never counts. Each budget row names a pass that does reach it and says why it
// must; a pass no row names fails, named by the function that ran it.

import { serializeMd } from "@platejs/markdown";
import { act, render } from "@testing-library/react";
import { createSlateEditor, TextApi } from "platejs";
import type { Point, SlateEditor, TElement } from "platejs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { getLiveEditor } from "@repo/editor/live-editor";
import { MarkdownEditor } from "@repo/editor/markdown-editor";
import { MD_STRINGIFY, parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { blockId } from "@repo/editor/node-props";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { generateLongNote } from "./markdown-doc-generator";

// jsdom rebuilds its document's named-property map on the first `document` read after any
// insertion, so a renderer that builds through `document.createElement` pays the whole DOM per
// node: minutes at this size. Both render a block once as it mounts, never on a keystroke
// elsewhere, so here they would measure jsdom.
vi.mock("katex", () => ({ render: () => {} }));
vi.mock("mermaid", () => ({
  default: {
    initialize: () => {},
    parse: async () => await Promise.resolve(true),
    render: async () => await Promise.resolve({ svg: "<svg></svg>" }),
  },
}));

const SEED = 704;
const LONG_LINES = 10_000;
const SHORT_LINES = LONG_LINES / 8;
const KEYSTROKES = 6;
// past the serialize debounce and the formula recompute behind it
const SETTLE_MS = 1000;

// every inline construct of the dialect, so a pass over any one kind of them reaches this block
const WATCHED_BLOCK =
  'Last words: a #field tag, a [[Hub]] link, a {{1+1|2}} pill, %%i:watched:start%%a comment%%i:watched:end%%, $$x$$ and <date value="2026-09-24" />.';
// the note's end is where a range or a point lands without walking the note, so the watched block
// is not the last one
const CLOSING_BLOCK = "The end.";

// Ratios rather than wall-clock ceilings, so a slow or loaded runner cannot fail them. Recorded: a
// keystroke costs 210-230ms in the long note against 26-27ms in the short one, 8x for eight times
// the lines, where a pass quadratic in the note shows; the settle costs 270ms against a 1,050ms
// parse of the note, and without patches/@platejs__core@53.3.14.patch 3,100ms, three times it.
// A memory-starved CI runner's garbage collection pushed the linear case to 12.4x; a quadratic
// pass is 64x, so 16 still catches it.
const KEYSTROKE_GROWTH_CEILING = 16;
const SETTLE_TO_PARSE_CEILING = 1;

interface Pass {
  readonly name: string;
  // a module of this package (`toc.tsx`) or a dependency (`@platejs/markdown`)
  readonly module: string;
}

interface BudgetRow extends Pass {
  readonly why: string;
}

const ROOT_NORMALIZE: BudgetRow = {
  module: "slate",
  name: "normalizeNode",
  why: "Slate normalizes every ancestor of an edit, the root among them, and the root's normalization looks at each top-level block",
};
const COMMENT_PAIRING: BudgetRow = {
  module: "comments/comment-ranges.ts",
  name: "commentSpans",
  why: "a comment may span blocks, so markers pair in document order; a block's edges are cached, each pair's extent is not",
};
const SORTABLE_IDS: BudgetRow = {
  module: "block-draggable.tsx",
  name: "sortableIds",
  why: "the sortable context lists every top-level block's id, and useEditorSelector asks on every change",
};
const FOLD_REACH: BudgetRow = {
  module: "heading-collapse.tsx",
  name: "derive",
  why: "a fold hides every block under its heading up to the next of its rank, which only the top level says, and useEditorSelector asks on every change",
};
const TOGGLE_INDEX: BudgetRow = {
  module: "@platejs/toggle",
  name: "buildToggleIndex",
  why: "Plate rebuilds its toggle index over the top level on every change",
};
const ROOT_DECORATIONS: BudgetRow = {
  module: "slate-dom",
  name: "splitDecorationsByChild",
  why: "comment tints are one root decoration, and slate-dom splits a root decoration over the blocks it covers on every render of the root",
};
const SELECTOR_SUBSCRIPTIONS: BudgetRow = {
  module: "slate-react",
  name: "current",
  why: "slate-react re-runs every element's useSlateSelector on each change: useSelected in an inline equation, a blockquote, an image",
};

const KEYSTROKE_BUDGET: readonly BudgetRow[] = [
  ROOT_NORMALIZE,
  COMMENT_PAIRING,
  SORTABLE_IDS,
  FOLD_REACH,
  TOGGLE_INDEX,
  ROOT_DECORATIONS,
  SELECTOR_SUBSCRIPTIONS,
];
const CARET_BUDGET: readonly BudgetRow[] = [
  SORTABLE_IDS,
  FOLD_REACH,
  TOGGLE_INDEX,
  ROOT_DECORATIONS,
  SELECTOR_SUBSCRIPTIONS,
];
// The save serializes the copy `pruneForMarkdown` keeps per top-level block, never the editor's own
// blocks, so its walk never reaches the watched one: the settle-to-parse ratio holds its cost.
const SETTLE_BUDGET: readonly BudgetRow[] = [
  {
    module: "formulas/formula-recompute.ts",
    name: "formulaEntries",
    why: "a pill may name any other pill in the note, so the recompute behind the save reads them all",
  },
];

const passLabel = ({ name, module }: Pass): string => `${name} (${module})`;

interface Frame {
  readonly fn: string;
  readonly module: string | null;
  readonly own: boolean;
}

const OWN_SOURCE = "/packages/editor/src/";
// pnpm's store path names a package twice; the last `node_modules/<name>/` is the one it runs from
const PACKAGE_RE = /\/node_modules\/(?!\.pnpm\/)(?<name>(?:@[^/]+\/)?[^/]+)\//gu;
const FRAME_RE = /^\s*at (?:async )?(?:(?<fn>.+?) \()?(?:file:\/\/)?(?<file>.+?):\d+:\d+\)?$/u;

const parseFrame = (line: string): Frame | null => {
  const groups = FRAME_RE.exec(line)?.groups;
  const file = groups?.file;
  if (file === undefined) {
    return null;
  }
  const fn = (groups?.fn ?? "").split(" ")[0]?.split(".").at(-1) ?? "";
  const ownAt = file.lastIndexOf(OWN_SOURCE);
  if (ownAt !== -1) {
    const module = file.slice(ownAt + OWN_SOURCE.length);
    return module.startsWith("__tests__/") ? null : { fn, module, own: true };
  }
  const module = [...file.matchAll(PACKAGE_RE)].at(-1)?.groups?.name ?? null;
  return { fn, module, own: false };
};

// the traversal every pass goes through, so never the one to name
const TRAVERSAL = new Set(["slate", "@platejs/slate", "@udecode/utils", "node-props.ts"]);
// an anonymous function, or one the React compiler hoisted (`t4`), names nothing a reader can find
const NAMELESS_RE = /^(?:t\d+|<anonymous>|)$/u;

const names = (frame: Frame): boolean =>
  frame.module !== null && !TRAVERSAL.has(frame.module) && !NAMELESS_RE.test(frame.fn);

// the row whose pass is on the stack, else the innermost function that could have run one
const nameRead = (stack: string, rows: readonly BudgetRow[]): string => {
  const frames = stack
    .split("\n")
    .slice(1)
    .map(parseFrame)
    .filter((frame) => frame !== null);
  for (const frame of frames) {
    const row = rows.find(
      (candidate) => candidate.name === frame.fn && candidate.module === frame.module,
    );
    if (row !== undefined) {
      return passLabel(row);
    }
  }
  const namer = frames.find((frame) => frame.own && names(frame)) ?? frames.find(names);
  return namer === undefined
    ? "an unnamed pass"
    : passLabel({ module: namer.module ?? "", name: namer.fn });
};

const reads: string[] = [];
let recording = false;

const recordedRead =
  <T,>(value: T) =>
  (): T => {
    if (recording) {
      reads.push(new Error("a read of the watched block").stack ?? "");
    }
    return value;
  };

// every property a getter that keeps the stack of its read; frozen like every node Slate holds, so
// immer never walks it to freeze it
const watch = (block: TElement): TElement => {
  const watched: TElement = { ...block };
  for (const [key, value] of Object.entries(block)) {
    Object.defineProperty(watched, key, { enumerable: true, get: recordedRead(value) });
  }
  return Object.freeze(watched);
};

const passesDuring = async (
  rows: readonly BudgetRow[],
  run: () => Promise<void>,
): Promise<ReadonlySet<string>> => {
  reads.length = 0;
  const limit = Error.stackTraceLimit;
  // a pass's own frame can sit far above the read, under Slate's traversal and Plate's overrides
  Error.stackTraceLimit = Number.POSITIVE_INFINITY;
  recording = true;
  try {
    await run();
  } finally {
    recording = false;
    Error.stackTraceLimit = limit;
  }
  return new Set(reads.map((stack) => nameRead(stack, rows)));
};

const expectBudget = (
  moment: string,
  rows: readonly BudgetRow[],
  observed: ReadonlySet<string>,
): void => {
  const allowed = rows.map(passLabel);
  const over = [...observed].filter((pass) => !allowed.includes(pass));
  const stale = allowed.filter((pass) => !observed.has(pass));
  expect(
    over,
    `${moment} walked the whole note through ${over.join(", ")}; its budget is ${String(allowed.length)} passes, ${allowed.join(", ")}. Take the pass off this path (a cache keyed by the top-level block, as toc.tsx and note-stats.ts keep, walks only the block that changed), or add a row with the reason it must run.`,
  ).toEqual([]);
  expect(
    stale,
    `${stale.join(", ")} no longer walk the whole note on ${moment}; drop the rows so the budget tightens.`,
  ).toEqual([]);
};

interface OpenNote {
  readonly editor: SlateEditor;
  readonly typeAt: Point;
  readonly elsewhere: Point;
  readonly unmount: () => void;
}

// a caret in a paragraph's own text, never inside an inline void, where an insert does nothing
const textEdge = (editor: SlateEditor, from: number, edge: "start" | "end"): Point => {
  for (let index = from; index < editor.children.length; index += 1) {
    const block = editor.children[index];
    if (block?.type === "p") {
      const childIndex = edge === "start" ? 0 : block.children.length - 1;
      const child = block.children[childIndex];
      if (child !== undefined && TextApi.isText(child) && child.text !== "") {
        return { offset: edge === "start" ? 0 : child.text.length, path: [index, childIndex] };
      }
    }
  }
  throw new Error("the note holds a paragraph of plain text past the point");
};

const noteOf = (lines: number): string =>
  `${generateLongNote(SEED, lines)}\n${WATCHED_BLOCK}\n\n${CLOSING_BLOCK}\n`;

const settle = async (): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(SETTLE_MS);
    await Promise.resolve();
  });
};

const keystroke = async (editor: SlateEditor): Promise<void> => {
  await act(async () => {
    editor.tf.insertText("x");
    await Promise.resolve();
  });
};

const moveCaret = async (editor: SlateEditor, to: Point): Promise<void> => {
  await act(async () => {
    editor.tf.select(to);
    await Promise.resolve();
  });
};

const openNote = async (path: string, lines: number): Promise<OpenNote> => {
  const store = createOpenNoteStore();
  store.publishOpenPath(path);
  // Plate leaves NodeIdPlugin off under NODE_ENV=test; the app runs it, and the fold and the drag
  // handle key every block by its id, so without it they would do none of their work here.
  vi.stubEnv("NODE_ENV", "development");
  const view = render(
    <OpenNoteStoreProvider store={store}>
      <MarkdownEditor path={path} value={noteOf(lines)} onChange={() => {}} />
    </OpenNoteStoreProvider>,
  );
  vi.unstubAllEnvs();
  await settle();
  const editor = getLiveEditor(path);
  const watched = editor?.children.at(-2);
  const closing = editor?.children.at(-1);
  if (
    editor === null ||
    watched === undefined ||
    closing === undefined ||
    blockId(watched) === undefined
  ) {
    throw new Error("the note opens rich, with node ids");
  }
  // Slate's own way to swap a value outside an operation: NodeIdPlugin clones an inserted node, so
  // an insert would never put the watched block itself in the document.
  await act(async () => {
    editor.children = [...editor.children.slice(0, -2), watch(watched), closing];
    editor.api.onChange();
    await Promise.resolve();
  });
  const middle = Math.floor(editor.children.length / 2);
  const typeAt = textEdge(editor, middle, "end");
  await moveCaret(editor, typeAt);
  // the first edit after a mount pays for every lazy chunk and first render it wakes
  await keystroke(editor);
  await settle();
  return {
    editor,
    elsewhere: textEdge(editor, Math.floor(middle / 2), "start"),
    typeAt,
    unmount: view.unmount,
  };
};

const timed = async (run: () => Promise<void>): Promise<number> => {
  const began = performance.now();
  await run();
  return performance.now() - began;
};

interface Costs {
  readonly keystrokeMs: number;
  readonly settleMs: number;
}

// the fastest of several, so one GC pause or scheduler stall cannot stand for the cost
const measure = async (note: OpenNote): Promise<Costs> => {
  let keystrokeMs = Number.POSITIVE_INFINITY;
  let settleMs = Number.POSITIVE_INFINITY;
  for (let round = 0; round < KEYSTROKES; round += 1) {
    keystrokeMs = Math.min(keystrokeMs, await timed(async () => await keystroke(note.editor)));
    settleMs = Math.min(settleMs, await timed(settle));
  }
  return { keystrokeMs, settleMs };
};

const fastestParseMs = (markdown: string): number => {
  let fastest = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run += 1) {
    const began = performance.now();
    parseMarkdown(markdown);
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
};

interface Observed {
  readonly keystrokes: readonly ReadonlySet<string>[];
  readonly caretMoves: readonly ReadonlySet<string>[];
  readonly settle: ReadonlySet<string>;
}

const observe = async (note: OpenNote): Promise<Observed> => {
  const keystrokes: ReadonlySet<string>[] = [];
  for (let index = 0; index < KEYSTROKES; index += 1) {
    keystrokes.push(await passesDuring(KEYSTROKE_BUDGET, async () => await keystroke(note.editor)));
  }
  const settled = await passesDuring(SETTLE_BUDGET, settle);
  const caretMoves = [
    await passesDuring(CARET_BUDGET, async () => await moveCaret(note.editor, note.elsewhere)),
    await passesDuring(CARET_BUDGET, async () => await moveCaret(note.editor, note.typeAt)),
  ];
  return { caretMoves, keystrokes, settle: settled };
};

const ms = (value: number): string => `${value.toFixed(0)}ms`;

describe(`typing in a ${String(LONG_LINES)}-line note`, () => {
  let short: Costs;
  let long: Costs;
  let parseMs: number;
  let observed: Observed;

  // Everything is collected here: the DOM suite unmounts every tree after each case.
  beforeAll(async () => {
    /* oxlint-disable class-methods-use-this -- the observer's instance API: `new ResizeObserver()` reaches these on the instance, never as statics */
    class ResizeObserverStub {
      observe = (): void => {};
      unobserve = (): void => {};
      disconnect = (): void => {};
    }
    /* oxlint-enable class-methods-use-this */
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    installFakeEditorHost();
    const small = await openNote("short.md", SHORT_LINES);
    short = await measure(small);
    small.unmount();
    const note = await openNote("long.md", LONG_LINES);
    long = await measure(note);
    observed = await observe(note);
    note.unmount();
    parseMs = fastestParseMs(noteOf(LONG_LINES));
  }, 600_000);

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("walks the note on a keystroke only through its budget", () => {
    for (const passes of observed.keystrokes) {
      expectBudget("a keystroke", KEYSTROKE_BUDGET, passes);
    }
  });

  it("walks the note on a caret move only through its budget", () => {
    for (const passes of observed.caretMoves) {
      expectBudget("a caret move", CARET_BUDGET, passes);
    }
  });

  it("walks the note once typing settles only through its budget", () => {
    expectBudget("the settle after typing", SETTLE_BUDGET, observed.settle);
  });

  it("costs a keystroke that grows no faster than the note", () => {
    const growth = long.keystrokeMs / short.keystrokeMs;
    expect(
      growth,
      `a keystroke costs ${ms(long.keystrokeMs)} in the ${String(LONG_LINES)}-line note and ${ms(short.keystrokeMs)} in the ${String(SHORT_LINES)}-line one, ${growth.toFixed(1)}x for eight times the lines; the ceiling is ${String(KEYSTROKE_GROWTH_CEILING)}x`,
    ).toBeLessThan(KEYSTROKE_GROWTH_CEILING);
  });

  it("settles for less than it cost to open the note", () => {
    const share = long.settleMs / parseMs;
    expect(
      share,
      `the settle after typing costs ${ms(long.settleMs)}, ${share.toFixed(2)}x the ${ms(parseMs)} parse that opened the note; the ceiling is ${String(SETTLE_TO_PARSE_CEILING)}x`,
    ).toBeLessThan(SETTLE_TO_PARSE_CEILING);
  });
});

describe("the save behind a settle", () => {
  // patches/@platejs__core@53.3.14.patch: the serializer asks the type of every mark rule on every
  // text node, most of them marks no plugin registers, and unpatched each such answer resolves one
  it("resolves no plugin for a mark the editor does not register", () => {
    const parsed = parseMarkdown(generateLongNote(SEED, 200));
    if (!parsed.ok) {
      throw new Error("the note parses");
    }
    const editor = createSlateEditor({ plugins: BASE_KIT, value: parsed.value });
    const asked = vi.spyOn(editor, "getPlugin");
    serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
    const unregistered = [
      ...new Set(
        asked.mock.calls.map(([plugin]) => plugin.key).filter((key) => !(key in editor.plugins)),
      ),
    ];
    expect(
      unregistered,
      `serializing resolved a plugin for ${unregistered.join(", ")}, keys no plugin registers; each is two deep merges per text node (patches/@platejs__core@53.3.14.patch)`,
    ).toEqual([]);
  });
});
