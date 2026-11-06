import { fireEvent, render, screen } from "@testing-library/react";
import type { Value } from "platejs";
import { describe, expect, it } from "vitest";

import { WIKI_PICKER_MAX_ROWS } from "@repo/editor/wiki/wiki-autocomplete";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki/wiki-input-key";
import type { LinkTarget } from "@repo/editor/host-io";

import { EditorHarness } from "./test-support/editor-harness";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

const LIBRARY_NOTES = 5000;

const openPicker = (linkTargets: readonly LinkTarget[]) => {
  installFakeEditorHost({ linkTargets });
  const value: Value = [
    {
      children: [
        { text: "see [" },
        { children: [{ text: "" }], type: WIKI_INPUT_KEY },
        { text: "" },
      ],
      type: "p",
    },
  ];
  render(<EditorHarness value={value} />);
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
    await expect(screen.findAllByRole("option")).resolves.toHaveLength(WIKI_PICKER_MAX_ROWS);
  });

  it("ranks a title prefix above every hit mid-title before cutting", async () => {
    openPicker([
      ...notesHolding("road"),
      { id: "0190a000-0000-7000-8000-ffffffffffff", title: "Roadmap" },
    ]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "road" } });
    const [first] = await screen.findAllByRole("option");
    expect(first?.textContent).toBe("Roadmap");
  });
});
