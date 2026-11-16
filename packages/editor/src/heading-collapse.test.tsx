import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { forgetHeadingFolds } from "@repo/editor/heading-collapse";

import { EditorHarness } from "./test-support/editor-harness";

const STORAGE_KEY = "inteligir.collapsed-headings";

const h2 = (id: string, text: string) => ({ children: [{ text }], id, type: "h2" });
const p = (id: string, text: string) => ({ children: [{ text }], id, type: "p" });

const mountNote = (itemId: string, value: Value): PlateEditor => {
  const ref = createRef<PlateEditor>();
  render(<EditorHarness value={value} itemId={itemId} ref={ref} nodeIds />);
  if (ref.current === null) {
    throw new Error("the editor did not mount");
  }
  return ref.current;
};

const STORED = z.object({ state: z.record(z.string(), z.array(z.string())) });

const storedFolds = (): Record<string, string[]> | null => {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : STORED.parse(JSON.parse(raw)).state;
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
  it("keeps a fold on its heading as blocks land above and inside the section", async () => {
    const editor = mountNote("fold-live", [
      h2("a", "A"),
      p("a-body", "a body"),
      h2("b", "B"),
      p("b-body", "b body"),
    ]);

    fireEvent.click(chevronOf("A"));
    expect(hiddenBlocks()).toStrictEqual(["a body"]);

    await act(async () => {
      editor.tf.insertNodes(p("top", "top"), { at: [0] });
    });
    expect(hiddenBlocks()).toStrictEqual(["a body"]);
    expect(chevronOf("A").getAttribute("aria-expanded")).toBe("false");
    expect(chevronCount()).toBe(2);

    await act(async () => {
      editor.tf.insertText(" line", { at: { offset: 3, path: [0, 0] } });
    });
    expect(hiddenBlocks()).toStrictEqual(["a body"]);

    await act(async () => {
      editor.tf.insertNodes(h2("c", "C"), { at: [3] });
    });
    expect(hiddenBlocks()).toStrictEqual(["a body"]);
    expect(chevronCount()).toBe(3);
    expect(chevronOf("C").getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      editor.tf.insertNodes(p("inside", "inside"), { at: [2] });
    });
    expect(hiddenBlocks()).toStrictEqual(["inside", "a body"]);
  });

  it("keeps a fold on its heading when a heading of the same words lands above it", async () => {
    const editor = mountNote("fold-twin", [h2("first", "Notes"), p("body", "a body")]);

    fireEvent.click(chevronOf("Notes"));
    await act(async () => {
      editor.tf.insertNodes([h2("twin", "Notes"), p("open", "stays open")], { at: [0] });
    });

    expect(hiddenBlocks()).toStrictEqual(["a body"]);
  });

  it("keeps the fold when the heading's text changes, since its id is its key", async () => {
    const editor = mountNote("fold-rename", [h2("a", "A"), p("a-body", "a body")]);

    fireEvent.click(chevronOf("A"));
    await act(async () => {
      editor.tf.insertText("!", { at: { offset: 1, path: [0, 0] } });
    });

    expect(hiddenBlocks()).toStrictEqual(["a body"]);
    expect(chevronOf("A!").getAttribute("aria-expanded")).toBe("false");
  });

  it("lets a deleted heading's fold go on the next toggle", async () => {
    const editor = mountNote("fold-prune", [
      h2("a", "A"),
      p("a-body", "a body"),
      h2("b", "B"),
      p("b-body", "b body"),
    ]);

    fireEvent.click(chevronOf("A"));
    await act(async () => {
      editor.tf.removeNodes({ at: [0] });
    });
    fireEvent.click(chevronOf("B"));

    expect(storedFolds()).toMatchObject({ "fold-prune": ["b"] });
  });

  it("folds under the item that was toggled and no other", () => {
    mountNote("fold-one", [h2("one", "One"), p("one-body", "one body")]);
    mountNote("fold-two", [h2("one", "Two"), p("two-body", "two body")]);

    fireEvent.click(chevronOf("One"));

    expect(hiddenBlocks()).toStrictEqual(["one body"]);
    expect(storedFolds()).toMatchObject({ "fold-one": ["one"] });
    expect(storedFolds()).not.toHaveProperty("fold-two");
  });

  it("follows another tab's folds, and keeps them when it folds one of its own", async () => {
    mountNote("fold-here", [h2("here", "Here"), p("here-body", "here body")]);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { "fold-here": ["here"], "fold-there": ["there"] }, version: 0 }),
    );

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });
    expect(hiddenBlocks()).toStrictEqual(["here body"]);

    fireEvent.click(chevronOf("Here"));
    expect(storedFolds()).toStrictEqual({ "fold-there": ["there"] });
  });

  it("opens the open item's folds when the account leaves, memory and storage alike", () => {
    mountNote("fold-forgotten", [h2("a", "A"), p("a-body", "a body")]);

    fireEvent.click(chevronOf("A"));
    expect(hiddenBlocks()).toStrictEqual(["a body"]);

    act(() => {
      forgetHeadingFolds();
    });
    expect(hiddenBlocks()).toStrictEqual([]);
    expect(storedFolds()).toStrictEqual({});
  });

  it("keeps none of a heading's words in the page's storage", () => {
    mountNote("fold-private", [h2("plan", "Termination plan for Dana"), p("body", "a body")]);

    fireEvent.click(chevronOf("Termination plan for Dana"));
    expect(hiddenBlocks()).toStrictEqual(["a body"]);
    expect(localStorage.getItem(STORAGE_KEY)).not.toMatch(/Termination/u);
  });
});
