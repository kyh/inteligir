// @vitest-environment jsdom
// The panel under test is the compiled one: a read of the editor during render is memoized on
// the editor there, so a panel that reads rather than subscribes passes uncompiled and reverts
// edits in the built app.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getLiveEditor } from "@repo/editor/live-editor";
import { MarkdownEditor } from "@repo/editor/markdown-editor";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { readFrontmatterRaw, writeFrontmatterRaw } from "@repo/editor/properties/properties-node";
import { PropertiesPanel } from "@repo/editor/properties/properties-panel";

import { InlineProperties } from "../actions-panel";

afterEach(cleanup);

const PATH = "note.md";
const NOTE = "---\ntitle: Note\ndone: false\n---\n\nbody\n";

const mountEditor = (onChange = vi.fn<(markdown: string) => void>()) =>
  render(
    <OpenNoteStoreProvider store={createOpenNoteStore()}>
      <MarkdownEditor path={PATH} value={NOTE} onChange={onChange} />
    </OpenNoteStoreProvider>,
  );

const mountSection = () =>
  render(<InlineProperties docPath={PATH} open onOpenChange={vi.fn<(open: boolean) => void>()} />);

const liveEditor = () => {
  const editor = getLiveEditor(PATH);
  if (editor === null) {
    throw new Error("the editor registers itself on mount");
  }
  return editor;
};

// Slate flushes its onChange on a microtask, and that is what announces the write to the panel
const settle = async (run: () => void): Promise<void> => {
  await act(async () => {
    run();
  });
};

const editText = async (key: string, value: string): Promise<void> => {
  const field = screen.getByRole("textbox", { name: key });
  await settle(() => {
    fireEvent.change(field, { target: { value } });
    fireEvent.blur(field);
  });
};

const toggle = async (key: string): Promise<void> => {
  await settle(() => {
    fireEvent.click(screen.getByRole("checkbox", { name: key }));
  });
};

describe("the Metadata tab's properties", () => {
  it("runs the panel as the compiler emits it", () => {
    expect(
      PropertiesPanel.toString(),
      "the desktop project must compile @repo/editor's sources, or this suite cannot see a memoized read",
    ).toContain("react.memo_cache_sentinel");
  });

  it("mounts the panel when the note's editor registers after the section drew", () => {
    mountSection();
    expect(screen.getByText("Open the note to edit properties.")).toBeTruthy();
    mountEditor();
    expect(screen.getByRole("textbox", { name: "title" })).toBeTruthy();
    expect(screen.queryByText("Open the note to edit properties.")).toBeNull();
  });

  it("keeps every edit when several land in a row", async () => {
    const onChange = vi.fn<(markdown: string) => void>();
    mountEditor(onChange);
    mountSection();
    await editText("title", "Renamed");
    await toggle("done");
    await toggle("done");
    await toggle("done");
    expect(readFrontmatterRaw(liveEditor())).toBe("title: Renamed\ndone: true");
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("---\ntitle: Renamed\ndone: true\n---\n\nbody\n");
    });
  });

  it("shows an outside frontmatter write, and the next panel edit keeps it", async () => {
    mountEditor();
    mountSection();
    await settle(() => {
      const editor = liveEditor();
      writeFrontmatterRaw(editor, `${readFrontmatterRaw(editor) ?? ""}\npinned: true`);
    });
    expect(screen.getByRole("checkbox", { name: "pinned" })).toBeTruthy();
    await editText("title", "Renamed");
    expect(readFrontmatterRaw(liveEditor())).toBe("title: Renamed\ndone: false\npinned: true");
  });

  it("lands an edit on the frontmatter as it stands, not as the panel last drew it", async () => {
    mountEditor();
    mountSection();
    const title = screen.getByRole("textbox", { name: "title" });
    fireEvent.change(title, { target: { value: "Renamed" } });
    await settle(() => {
      const editor = liveEditor();
      writeFrontmatterRaw(editor, `${readFrontmatterRaw(editor) ?? ""}\npinned: true`);
      fireEvent.blur(title);
    });
    expect(readFrontmatterRaw(liveEditor())).toBe("title: Renamed\ndone: false\npinned: true");
  });
});
