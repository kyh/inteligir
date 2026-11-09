import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { KEYS } from "platejs";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";

import type { LinkTarget } from "@repo/editor/host-io";
import { serializeNote } from "@repo/editor/markdown/markdown-doc";
import { MENTION_PICKER_MAX_ROWS } from "@repo/editor/mention/mention-input";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "../test-support/editor-harness";

const LIBRARY_NOTES = 5000;

const PLAN = "0190a000-0000-7000-8000-000000000001";
const PLANTS = "0190a000-0000-7000-8000-000000000002";

// the editor with `see [` typed and the picker the second `[` opened
const openPicker = (titles: readonly LinkTarget[]) => {
  const host = installFakeEditorHost({ titles });
  const value: Value = [
    {
      children: [
        { text: "see [" },
        { children: [{ text: "" }], trigger: "[", type: KEYS.mentionInput },
        { text: "" },
      ],
      type: "p",
    },
  ];
  const ref = createRef<PlateEditor>();
  render(<EditorHarness ref={ref} value={value} />);
  const editor = (): PlateEditor => {
    if (ref.current === null) {
      throw new Error("the editor never mounted");
    }
    return ref.current;
  };
  // the caret inside the input, where the trigger's insert leaves it
  act(() => {
    editor().tf.select({ offset: 0, path: [0, 1, 0] });
  });
  return { calls: host.calls, markdown: () => serializeNote(editor()) };
};

const typeQuery = (query: string): void => {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
};

const rows = async (): Promise<(string | null)[]> => {
  const options = await screen.findAllByRole("option");
  return options.map((option) => option.textContent);
};

// jsdom lights no row as the query changes, where a browser lights the first, so the arrows do
const lightRow = async (name: string): Promise<HTMLElement> => {
  const row = await screen.findByRole("option", { name });
  const field = screen.getByRole("combobox");
  for (let press = 0; press < 3 && !row.hasAttribute("data-highlighted"); press += 1) {
    fireEvent.keyDown(field, { key: "ArrowDown" });
  }
  expect(row.hasAttribute("data-highlighted")).toBe(true);
  return field;
};

// notes whose titles all hold `word`, mid-title
const notesHolding = (word: string): LinkTarget[] =>
  Array.from({ length: LIBRARY_NOTES }, (_, i) => ({
    id: `0190a000-0000-7000-8000-${String(i).padStart(12, "0")}`,
    title: `n ${word} ${String(i)}`,
  }));

describe("the [[ picker over a large library", () => {
  it("mounts no more rows than the cap", async () => {
    openPicker(notesHolding("note"));
    await expect(screen.findAllByRole("option")).resolves.toHaveLength(MENTION_PICKER_MAX_ROWS);
  });

  it("ranks a title prefix above every hit mid-title before cutting", async () => {
    openPicker([
      ...notesHolding("road"),
      { id: "0190a000-0000-7000-8000-ffffffffffff", title: "Roadmap" },
    ]);
    typeQuery("road");
    const [first] = await rows();
    expect(first).toBe("Roadmap");
  });
});

describe("the [[ picker's rows", () => {
  it("links the row picked by its id, under the title it goes by", async () => {
    const { markdown } = openPicker([
      { id: PLANTS, title: "Plants" },
      { id: PLAN, title: "Plan" },
    ]);
    typeQuery("plan");
    fireEvent.click(await screen.findByRole("option", { name: "Plan" }));
    expect(markdown()).toBe(`see [Plan](mention:${PLAN})\n`);
  });

  it("offers Create for a title no item has, and makes the note before linking it", async () => {
    const { calls, markdown } = openPicker([{ id: PLAN, title: "Plan" }]);
    typeQuery("Wading birds");
    await expect(rows()).resolves.toStrictEqual(["Create Wading birds"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("option"));
      await Promise.resolve();
    });
    expect(calls).toStrictEqual([
      { action: "createNote", args: [{ blocks: [], title: "Wading birds" }] },
    ]);
    expect(markdown()).toBe("see [Wading birds](mention:note-1)\n");
  });

  it("offers no Create for a title an item has, whatever its case", async () => {
    openPicker([{ id: PLAN, title: "Plan" }]);
    typeQuery("plan");
    await expect(rows()).resolves.toStrictEqual(["Plan"]);
  });
});

describe("the [[ picker's keys", () => {
  it("Enter picks the lit row, and the arrows move the light", async () => {
    const { markdown } = openPicker([
      { id: PLAN, title: "Plan" },
      { id: PLANTS, title: "Plants" },
    ]);
    typeQuery("pla");
    const field = await lightRow("Plants");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(markdown()).toBe(`see [Plants](mention:${PLANTS})\n`);
  });

  it("an Enter that ends an IME composition picks nothing", async () => {
    const { markdown } = openPicker([{ id: PLAN, title: "Plan" }]);
    typeQuery("pla");
    const field = await lightRow("Plan");
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229, which: 229 });
    expect(markdown()).toBe("see \\[\n");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(markdown()).toBe(`see [Plan](mention:${PLAN})\n`);
  });

  it("typing ]] links the item the words name, whatever their case, the first of two", () => {
    const { markdown } = openPicker([
      { id: PLAN, title: "Q3/Q4 plan" },
      { id: PLANTS, title: "Q3/Q4 Plan" },
    ]);
    typeQuery("q3/q4 plan]]");
    expect(markdown()).toBe(`see [Q3/Q4 plan](mention:${PLAN})\n`);
  });

  it("typing ]] after words no item is titled leaves them the text they are", () => {
    const { markdown } = openPicker([{ id: PLAN, title: "Plan" }]);
    typeQuery("Someday]]");
    expect(markdown()).toBe("see \\[\\[Someday]]\n");
  });
});
