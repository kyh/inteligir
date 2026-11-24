import { serializeMd } from "@platejs/markdown";
import { act } from "@testing-library/react";
import { createSlateEditor, ElementApi, KEYS, TextApi } from "platejs";
import type { Point, SlateEditor, TElement } from "platejs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FORMULA_PILL_KEY } from "@repo/editor/headless/dialect-node-keys";
import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";
import { parseMarkdown } from "@repo/editor/headless/codec/markdown-doc";
import { MD_STRINGIFY } from "@repo/editor/headless/markdown/md-plugins";
import { blockId } from "@repo/editor/headless/node-props";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host.test-utils";
import { mountNote } from "./test-support/memory-note.test-utils";
import { memoryNotes } from "./test-support/memory-notes.test-utils";

import { generateLongNote } from "./test-support/markdown-doc-generator.test-utils";

vi.mock(import("katex"), () => ({ render: () => {} }));

const SEED = 704;
const LONG_LINES = 10_000;
const SHORT_LINES = LONG_LINES / 8;
const KEYSTROKES = 6;
const notes = memoryNotes();
const SETTLE_MS = 1000;

const WATCHED_BLOCK =
  'Last words: a #field tag, a [Hub](mention:0190a000-0000-7000-8000-000000000004) link, a :formula[2]{source="1+1"} pill, $$x$$ and :date[2026-09-24].';

const CLOSING_BLOCK = "The end.";

const KEYSTROKE_GROWTH_CEILING = 5;
const KEYSTROKE_TO_PARSE_CEILING = 0.035;
const COLLECT_TIMEOUT_MS = 1_500_000;

interface Pass {
  readonly name: string;
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

const SELECTOR_SUBSCRIPTIONS: BudgetRow = {
  module: "slate-react",
  name: "current",
  why: "slate-react re-runs every element's useSlateSelector on each change: useSelected in an inline equation, a blockquote, an image",
};

const KEYSTROKE_BUDGET: readonly BudgetRow[] = [
  ROOT_NORMALIZE,
  SORTABLE_IDS,
  FOLD_REACH,
  SELECTOR_SUBSCRIPTIONS,
];

const CARET_BUDGET: readonly BudgetRow[] = [SORTABLE_IDS, FOLD_REACH, SELECTOR_SUBSCRIPTIONS];

const WHOLE_SAVE: BudgetRow = {
  module: "headless/body/note-blocks.ts",
  name: "blocksOfValue",
  why: "a save carries the note whole (item/note-save.ts), so the one a pause sends reads every block once; what a change derives, a pill's display among it, lands inside the change",
};

const SETTLE_BUDGET: readonly BudgetRow[] = [WHOLE_SAVE];

const passLabel = ({ name, module }: Pass) => `${name} (${module})`;

interface Frame {
  readonly fn: string;
  readonly module: string | null;
  readonly own: boolean;
}

const OWN_SOURCE = "/packages/editor/src/";
const PACKAGE_RE = /\/node_modules\/(?!\.pnpm\/)(?<name>(?:@[^/]+\/)?[^/]+)\//gu;
const FRAME_RE = /^\s*at (?:async )?(?:(?<fn>.+?) \()?(?:file:\/\/)?(?<file>.+?):\d+:\d+\)?$/u;

const parseFrame = (line: string) => {
  const groups = FRAME_RE.exec(line)?.groups;
  const file = groups?.file;

  if (file === undefined) {
    return null;
  }

  const fn = (groups?.fn ?? "").split(" ")[0]?.split(".").at(-1) ?? "";
  const ownAt = file.lastIndexOf(OWN_SOURCE);

  if (ownAt !== -1) {
    const module = file.slice(ownAt + OWN_SOURCE.length);

    return (
      /(?:^|\/)test-support\/|\.test\.tsx?$/u.test(module) ? null : { fn, module, own: true }
    ) satisfies Frame | null;
  }

  const module = [...file.matchAll(PACKAGE_RE)].at(-1)?.groups?.name ?? null;

  return { fn, module, own: false } satisfies Frame | null;
};

const TRAVERSAL = new Set(["slate", "@platejs/slate", "@udecode/utils", "node-props.ts"]);
const NAMELESS_RE = /^(?:t\d+|<anonymous>|)$/u;

const names = (frame: Frame) =>
  frame.module !== null && !TRAVERSAL.has(frame.module) && !NAMELESS_RE.test(frame.fn);

const nameRead = (stack: string, rows: readonly BudgetRow[]) => {
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
  () => {
    if (recording) {
      reads.push(new Error("a read of the watched block").stack ?? "");
    }

    return value;
  };

const watch = (block: TElement) => {
  const watched: TElement = { ...block };

  for (const [key, value] of Object.entries(block)) {
    Object.defineProperty(watched, key, { enumerable: true, get: recordedRead(value) });
  }

  return Object.freeze(watched);
};

const passesDuring = async (rows: readonly BudgetRow[], run: () => Promise<void>) => {
  reads.length = 0;
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = Number.POSITIVE_INFINITY;
  recording = true;

  try {
    await run();
  } finally {
    recording = false;
    Error.stackTraceLimit = limit;
  }

  return new Set(reads.map((stack) => nameRead(stack, rows))) satisfies ReadonlySet<string>;
};

const expectBudget = (
  moment: string,
  rows: readonly BudgetRow[],
  observed: ReadonlySet<string>,
) => {
  const allowed = rows.map(passLabel);
  const over = [...observed].filter((pass) => !allowed.includes(pass));
  const stale = allowed.filter((pass) => !observed.has(pass));
  expect(
    over,
    `${moment} walked the whole note through ${over.join(", ")}; its budget is ${String(allowed.length)} passes, ${allowed.join(", ")}. Take the pass off this path (a cache keyed by the top-level block, as toc.tsx keeps, walks only the block that changed), or add a row with the reason it must run.`,
  ).toStrictEqual([]);
  expect(
    stale,
    `${stale.join(", ")} no longer walk the whole note on ${moment}; drop the rows so the budget tightens.`,
  ).toStrictEqual([]);
};

interface OpenNote {
  readonly editor: SlateEditor;
  readonly typeAt: Point;
  readonly elsewhere: Point;
  readonly unmount: () => void;
}

const textEdge = (editor: SlateEditor, from: number, edge: "start" | "end") => {
  for (let index = from; index < editor.children.length; index += 1) {
    const block = editor.children[index];

    if (block?.type === "p") {
      const childIndex = edge === "start" ? 0 : block.children.length - 1;
      const child = block.children[childIndex];

      if (child !== undefined && TextApi.isText(child) && child.text !== "") {
        return {
          offset: edge === "start" ? 0 : child.text.length,
          path: [index, childIndex],
        } satisfies Point;
      }
    }
  }

  throw new Error("the note holds a paragraph of plain text past the point");
};

const noteOf = (lines: number) =>
  `${generateLongNote(SEED, lines)}\n${WATCHED_BLOCK}\n\n${CLOSING_BLOCK}\n`;

const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(SETTLE_MS);
    await Promise.resolve();
  });
};

const keystroke = async (editor: SlateEditor) => {
  await act(async () => {
    editor.tf.insertText("x");
    await Promise.resolve();
  });
};

const moveCaret = async (editor: SlateEditor, to: Point) => {
  await act(async () => {
    editor.tf.select(to);
    await Promise.resolve();
  });
};

const openNote = async (itemId: string, lines: number) => {
  const { editor, unmount } = await mountNote(notes, itemId, noteOf(lines));
  await settle();
  const watched = editor.children.at(-2);
  const closing = editor.children.at(-1);

  if (watched === undefined || closing === undefined || blockId(watched) === undefined) {
    throw new Error("the item opens rich, with node ids");
  }

  await act(async () => {
    editor.children = [...editor.children.slice(0, -2), watch(watched), closing];
    editor.api.onChange();
    await Promise.resolve();
  });
  const middle = Math.floor(editor.children.length / 2);
  const typeAt = textEdge(editor, middle, "end");
  await moveCaret(editor, typeAt);
  await keystroke(editor);
  await settle();

  return {
    editor,
    elsewhere: textEdge(editor, Math.floor(middle / 2), "start"),
    typeAt,
    unmount,
  } satisfies OpenNote;
};

const timed = async (run: () => Promise<void>) => {
  const began = performance.now();
  await run();

  return performance.now() - began;
};

const keystrokeMsIn = async (note: OpenNote) => {
  let fastest = Number.POSITIVE_INFINITY;

  for (let round = 0; round < KEYSTROKES; round += 1) {
    fastest = Math.min(
      fastest,
      await timed(async () => {
        await keystroke(note.editor);
      }),
    );
    await settle();
  }

  return fastest;
};

const fastestParseMs = (markdown: string) => {
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

const observe = async (note: OpenNote) => {
  const keystrokes: ReadonlySet<string>[] = [];

  for (let index = 0; index < KEYSTROKES; index += 1) {
    keystrokes.push(
      await passesDuring(KEYSTROKE_BUDGET, async () => {
        await keystroke(note.editor);
      }),
    );
  }

  const settled = await passesDuring(SETTLE_BUDGET, settle);

  const caretMoves = [
    await passesDuring(CARET_BUDGET, async () => {
      await moveCaret(note.editor, note.elsewhere);
    }),
    await passesDuring(CARET_BUDGET, async () => {
      await moveCaret(note.editor, note.typeAt);
    }),
  ];

  return { caretMoves, keystrokes, settle: settled } satisfies Observed;
};

const ms = (value: number) => `${value.toFixed(0)}ms`;

describe(`typing in a ${String(LONG_LINES)}-line note`, () => {
  let shortMs: number;
  let longMs: number;
  let parseMs: number;
  let observed: Observed;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    installFakeEditorHost({ notes });
    const small = await openNote("short", SHORT_LINES);
    shortMs = await keystrokeMsIn(small);
    small.unmount();
    const note = await openNote("long", LONG_LINES);
    longMs = await keystrokeMsIn(note);
    observed = await observe(note);
    note.unmount();
    parseMs = fastestParseMs(noteOf(LONG_LINES));
  }, COLLECT_TIMEOUT_MS);

  afterAll(() => {
    vi.useRealTimers();
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

  it("walks the note once typing settles only to save it whole", () => {
    expectBudget("the settle after typing", SETTLE_BUDGET, observed.settle);
  });

  it("costs a keystroke that grows no faster than the note", () => {
    const growth = longMs / shortMs;
    expect(
      growth,
      `a keystroke costs ${ms(longMs)} in the ${String(LONG_LINES)}-line note and ${ms(shortMs)} in the ${String(SHORT_LINES)}-line one, ${growth.toFixed(1)}x for eight times the lines; the ceiling is ${String(KEYSTROKE_GROWTH_CEILING)}x`,
    ).toBeLessThan(KEYSTROKE_GROWTH_CEILING);
  });

  it("costs a keystroke a small share of reading the note", () => {
    const share = longMs / parseMs;
    expect(
      share,
      `a keystroke in the ${String(LONG_LINES)}-line note costs ${ms(longMs)}, ${share.toFixed(3)}x the ${ms(parseMs)} parse that opened it; the ceiling is ${String(KEYSTROKE_TO_PARSE_CEILING)}x, and a store atom every block holds is 0.06x`,
    ).toBeLessThan(KEYSTROKE_TO_PARSE_CEILING);
  });
});

describe("the watched block", () => {
  it("holds every inline void of the dialect, as its node", () => {
    const parsed = parseMarkdown(WATCHED_BLOCK);

    if (!parsed.ok) {
      throw new Error("the watched block parses");
    }

    expect(
      parsed.value[0]?.children.flatMap((child) =>
        ElementApi.isElement(child) ? [child.type] : [],
      ),
    ).toStrictEqual([KEYS.mention, FORMULA_PILL_KEY, KEYS.inlineEquation, KEYS.date]);
  });
});

describe("the codec's serializer", () => {
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
      `serializing resolved a plugin for ${unregistered.join(", ")}, keys no plugin registers; each is two deep merges per text node (patches/@platejs__core@53.5.2.patch)`,
    ).toStrictEqual([]);
  });
});
