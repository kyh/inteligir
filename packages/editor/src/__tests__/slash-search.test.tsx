import { fireEvent, render, screen } from "@testing-library/react";
import { KEYS } from "platejs";
import type { Value } from "platejs";
import { beforeEach, describe, expect, it } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { GROUPS } from "@repo/editor/slash-menu";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "./editor-harness";

const rowLabelled = (label: string) => {
  const row = GROUPS.flatMap((group) => group.items).find((item) => item.label === label);
  if (row === undefined) {
    throw new Error(`no slash row is labelled ${label}`);
  }
  return row;
};

const searchSlashMenu = async (typed: string): Promise<string[]> => {
  const value: Value = [
    {
      children: [{ text: "" }, { children: [{ text: "" }], type: KEYS.slashInput }, { text: "" }],
      type: "p",
    },
  ];
  render(<EditorHarness store={createOpenNoteStore()} value={value} />);
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: typed } });
  const options = await screen.findAllByRole("option");
  return options.map((option) => option.textContent);
};

describe("the slash menu's search", () => {
  beforeEach(() => {
    installFakeEditorHost();
  });

  it("finds today's date chip under /day, in one row", async () => {
    const date = rowLabelled("Date");
    const shown = await searchSlashMenu("day");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain(date.description);
  });
});
