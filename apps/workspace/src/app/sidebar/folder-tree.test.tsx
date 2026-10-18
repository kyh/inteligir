// @vitest-environment jsdom

// the rail's folders as a keyboard reaches them: one tab stop for the whole tree, ↑ and ↓ walking
// the rows shown, Home and End at either end, → opening a folder, and F2 renaming the row.

import { SidebarProvider } from "@repo/ui/components/sidebar-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FolderTree } from "./folder-tree";
import type { TreeOps } from "./tree-ops";

afterEach(() => {
  cleanup();
});

const ops = (): TreeOps => ({
  createFolder: vi.fn<TreeOps["createFolder"]>(),
  createNote: vi.fn<TreeOps["createNote"]>(),
  moveEntry: vi.fn<TreeOps["moveEntry"]>(async () => await Promise.resolve(true)),
  removeFolder: vi.fn<TreeOps["removeFolder"]>(),
  renameEntry: vi.fn<TreeOps["renameEntry"]>(async () => await Promise.resolve(true)),
  setPinned: vi.fn<TreeOps["setPinned"]>(),
});

const mount = () =>
  render(
    <SidebarProvider>
      <FolderTree
        folders={[
          { items: 3, path: "Archive" },
          { items: 1, path: "Archive/2025" },
          { items: 4, path: "Reading" },
          { items: 2, path: "Recipes" },
        ]}
        activeFolder={null}
        onScope={vi.fn()}
        ops={ops()}
        onMoveRequest={vi.fn()}
        onNewNoteIn={vi.fn()}
        onSaveInto={vi.fn()}
        createAtRoot={0}
      />
    </SidebarProvider>,
  );

const row = (name: string): HTMLElement => {
  const found = screen
    .getAllByRole("treeitem")
    .find((element) => element.textContent?.includes(name) === true);
  if (found === undefined) {
    throw new Error(`no row for ${name}`);
  }
  return found;
};

describe("the folder tree from the keyboard", () => {
  it("is one tab stop, and the arrows, Home and End walk its rows", () => {
    mount();
    const stops = screen.getAllByRole("treeitem").filter((element) => element.tabIndex === 0);
    expect(stops).toEqual([row("Archive")]);
    row("Archive").focus();
    fireEvent.keyDown(row("Archive"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("Reading"));
    fireEvent.keyDown(row("Reading"), { key: "End" });
    expect(document.activeElement).toBe(row("Recipes"));
    fireEvent.keyDown(row("Recipes"), { key: "Home" });
    expect(document.activeElement).toBe(row("Archive"));
    fireEvent.keyDown(row("Archive"), { key: "F2" });
    expect(screen.getByRole("textbox", { name: "Folder name" })).toHaveProperty("value", "Archive");
  });

  it("opens a folder with →, and walks into what it opened", () => {
    mount();
    row("Archive").focus();
    fireEvent.keyDown(row("Archive"), { key: "ArrowRight" });
    expect(row("Archive").getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(row("Archive"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("2025"));
  });
});
