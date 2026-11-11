// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forgetHeadingFolds,
  headingCollapseKeys,
  toggleHeadingCollapse,
} from "@repo/editor/heading-collapse";

import { EditorHarness } from "./test-support/editor-harness";

const stubStorage = (): Map<string, string> => {
  const written = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => written.get(key) ?? null,
    removeItem: (key: string) => {
      written.delete(key);
    },
    setItem: (key: string, value: string) => {
      written.set(key, value);
    },
  });
  return written;
};

describe("heading collapse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("folds under the note that was toggled and no other", () => {
    stubStorage();
    toggleHeadingCollapse("notes/a.md", "1:Intro:0");

    expect([...headingCollapseKeys("notes/a.md")]).toStrictEqual(["1:Intro:0"]);
    expect([...headingCollapseKeys("notes/b.md")]).toStrictEqual([]);
  });

  it("persists every note's folds in one record, keyed by path", () => {
    const written = stubStorage();
    toggleHeadingCollapse("notes/c.md", "1:Intro:0");
    toggleHeadingCollapse("notes/d.md", "2:Details:0");

    expect(written.size).toBe(1);
    const stored: unknown = JSON.parse([...written.values()][0] ?? "{}");
    expect(stored).toStrictEqual({ "notes/c.md": ["1:Intro:0"], "notes/d.md": ["2:Details:0"] });
  });

  it("lets every note's folds go when the account leaves", () => {
    const written = stubStorage();
    toggleHeadingCollapse("notes/e.md", "1:Intro:0");
    expect(written.size).toBe(1);

    forgetHeadingFolds();

    expect(written.size).toBe(0);
    expect([...headingCollapseKeys("notes/e.md")]).toStrictEqual([]);
  });
});

const h2 = (text: string) => ({ children: [{ text }], type: "h2" });
const p = (text: string) => ({ children: [{ text }], type: "p" });

const mountNote = (itemId: string, value: Value): PlateEditor => {
  stubStorage();
  const ref = createRef<PlateEditor>();
  render(<EditorHarness value={value} itemId={itemId} ref={ref} nodeIds />);
  if (ref.current === null) {
    throw new Error("the editor did not mount");
  }
  return ref.current;
};

const block = (text: string): Element => {
  const found = [...document.querySelectorAll('[data-slate-node="element"]')].find(
    (node) => node.textContent === text,
  );
  if (found === undefined) {
    throw new Error(`no block reads "${text}"`);
  }
  return found;
};

const hiddenBlocks = (): string[] =>
  [...document.querySelectorAll('[data-slate-node="element"]')]
    .filter((node) => node.closest(".hidden") !== null)
    .map((node) => node.textContent);

const chevronOf = (text: string): HTMLElement => {
  const section = block(text).closest(".group\\/heading");
  const button = section?.querySelector("button");
  if (!(button instanceof HTMLElement)) {
    throw new TypeError(`"${text}" has no chevron`);
  }
  return button;
};

const chevronCount = (): number =>
  screen.queryAllByRole("button", { name: /^(?:Collapse|Expand) section$/u }).length;

describe("folds over a live document", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a fold on its heading as blocks land above and inside the section", async () => {
    const editor = mountNote("notes/fold-live.md", [h2("A"), p("a body"), h2("B"), p("b body")]);

    fireEvent.click(chevronOf("A"));
    expect(hiddenBlocks()).toStrictEqual(["a body"]);

    await act(async () => {
      editor.tf.insertNodes(p("top"), { at: [0] });
    });
    expect(hiddenBlocks()).toStrictEqual(["a body"]);
    expect(chevronOf("A").getAttribute("aria-expanded")).toBe("false");
    expect(chevronCount()).toBe(2);

    await act(async () => {
      editor.tf.insertText(" line", { at: { offset: 3, path: [0, 0] } });
    });
    expect(hiddenBlocks()).toStrictEqual(["a body"]);

    await act(async () => {
      editor.tf.insertNodes(h2("C"), { at: [3] });
    });
    expect(hiddenBlocks()).toStrictEqual(["a body"]);
    expect(chevronCount()).toBe(3);
    expect(chevronOf("C").getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      editor.tf.insertNodes(p("inside"), { at: [2] });
    });
    expect(hiddenBlocks()).toStrictEqual(["inside", "a body"]);
  });

  it("opens the open item's folds when the account leaves, memory and storage alike", () => {
    mountNote("notes/fold-forgotten.md", [h2("A"), p("a body")]);
    const written = stubStorage();

    fireEvent.click(chevronOf("A"));
    expect(hiddenBlocks()).toStrictEqual(["a body"]);

    act(() => {
      forgetHeadingFolds();
    });
    expect(hiddenBlocks()).toStrictEqual([]);
    expect([...headingCollapseKeys("notes/fold-forgotten.md")]).toStrictEqual([]);
    expect(written.size).toBe(0);
  });

  it("keeps none of a heading's words in the page's storage", () => {
    mountNote("notes/fold-private.md", [h2("Termination plan for Dana"), p("a body")]);
    const written = stubStorage();

    fireEvent.click(chevronOf("Termination plan for Dana"));
    expect(hiddenBlocks()).toStrictEqual(["a body"]);
    expect(written.size).toBe(1);
    expect([...written.values()].join("\n")).not.toMatch(/Termination/u);
  });

  it("drops the fold when the heading's text changes, since the text is its key", async () => {
    const editor = mountNote("notes/fold-rename.md", [h2("A"), p("a body")]);

    fireEvent.click(chevronOf("A"));
    expect(hiddenBlocks()).toStrictEqual(["a body"]);

    await act(async () => {
      editor.tf.insertText("!", { at: { offset: 1, path: [0, 0] } });
    });
    expect(hiddenBlocks()).toStrictEqual([]);
    expect(chevronOf("A!").getAttribute("aria-expanded")).toBe("true");
  });
});
