import { fireEvent, render, screen } from "@testing-library/react";
import type { Value } from "platejs";
import { describe, expect, it } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { WIKI_PICKER_MAX_ROWS } from "@repo/editor/wiki-autocomplete";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki-input-key";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";

import { EditorHarness } from "./editor-harness";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

const VAULT_NOTES = 5000;

const openPicker = (wikiTargets: readonly WikiTarget[]) => {
  installFakeEditorHost({ wikiTargets });
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
  render(<EditorHarness value={value} store={createOpenNoteStore()} />);
};

const folderOfNotes = (folder: string): WikiTarget[] =>
  Array.from({ length: VAULT_NOTES }, (_, i) => ({
    path: `${folder}/n ${String(i)}.md`,
    title: `n ${String(i)}`,
    type: "doc",
  }));

describe("the [[ picker over a large vault", () => {
  it("mounts no more rows than the cap", async () => {
    openPicker(folderOfNotes("notes"));
    expect(await screen.findAllByRole("option")).toHaveLength(WIKI_PICKER_MAX_ROWS);
  });

  it("ranks a stem prefix above every path hit before cutting", async () => {
    openPicker([
      ...folderOfNotes("road"),
      { path: "zz/Roadmap.md", title: "Roadmap", type: "doc" },
    ]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "road" } });
    const [first] = await screen.findAllByRole("option");
    expect(first?.textContent).toContain("zz/Roadmap.md");
  });
});
