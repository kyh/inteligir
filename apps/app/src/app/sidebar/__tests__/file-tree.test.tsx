// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VaultEntry } from "@repo/server-contract/vault";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTree, type TreeOps } from "../file-tree";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  { kind: "dir", path: "notes/daily" },
  { kind: "file", path: "notes/daily/2026-08-16.md", size: 10 },
  { kind: "file", path: "notes/ideas.md", size: 5 },
  { kind: "file", path: "Welcome.md", size: 20 },
];

function makeOps(): TreeOps {
  return {
    createNote: vi.fn(),
    createFolder: vi.fn(),
    renameEntry: vi.fn(),
    removeEntry: vi.fn(),
  };
}

function renderTree(overrides: Partial<React.ComponentProps<typeof FileTree>> = {}): {
  ops: TreeOps;
  onOpenFile: ReturnType<typeof vi.fn>;
} {
  const ops = makeOps();
  const onOpenFile = vi.fn();
  render(
    <FileTree
      entries={ENTRIES}
      openPath={null}
      onOpenFile={onOpenFile}
      ops={ops}
      pendingCreate={null}
      onPendingCreateHandled={() => {}}
      {...overrides}
    />,
  );
  return { ops, onOpenFile };
}

function row(path: string): HTMLElement {
  const element = document.querySelector(`[data-path="${path}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no row for ${path}`);
  }
  return element;
}

afterEach(cleanup);

describe("rendering", () => {
  it("shows top-level entries with folders collapsed", () => {
    renderTree();
    expect(screen.getByText("notes")).toBeDefined();
    expect(screen.getByText("Welcome.md")).toBeDefined();
    expect(screen.queryByText("ideas.md")).toBeNull();
  });

  it("expands a folder on click and collapses it again", () => {
    renderTree();
    fireEvent.click(row("notes"));
    expect(screen.getByText("ideas.md")).toBeDefined();
    expect(screen.getByText("daily")).toBeDefined();
    fireEvent.click(row("notes"));
    expect(screen.queryByText("ideas.md")).toBeNull();
  });

  it("marks the open note as selected", () => {
    renderTree({ openPath: "Welcome.md" });
    expect(row("Welcome.md").getAttribute("aria-selected")).toBe("true");
  });

  it("auto-expands the ancestors of the open note", () => {
    renderTree({ openPath: "notes/daily/2026-08-16.md" });
    expect(screen.getByText("2026-08-16.md")).toBeDefined();
  });
});

describe("keyboard navigation", () => {
  it("has exactly one tab stop (roving tabindex)", () => {
    renderTree();
    const stops = document.querySelectorAll('[role="treeitem"][tabindex="0"]');
    expect(stops).toHaveLength(1);
  });

  it("moves focus down and up with the arrow keys", () => {
    renderTree();
    const first = row("notes");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("Welcome.md"));
    fireEvent.keyDown(row("Welcome.md"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("notes"));
  });

  it("ArrowRight expands a collapsed folder, then moves into it", () => {
    renderTree();
    const notes = row("notes");
    notes.focus();
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    expect(screen.getByText("daily")).toBeDefined();
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("notes/daily"));
  });

  it("ArrowLeft collapses an expanded folder and walks to the parent from a child", () => {
    renderTree();
    fireEvent.click(row("notes"));
    const ideas = row("notes/ideas.md");
    ideas.focus();
    fireEvent.keyDown(ideas, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(row("notes"));
    fireEvent.keyDown(row("notes"), { key: "ArrowLeft" });
    expect(screen.queryByText("ideas.md")).toBeNull();
  });

  it("Enter opens a file", () => {
    const { onOpenFile } = renderTree();
    const welcome = row("Welcome.md");
    welcome.focus();
    fireEvent.keyDown(welcome, { key: "Enter" });
    expect(onOpenFile).toHaveBeenCalledWith("Welcome.md");
  });

  it("Home and End jump to the first and last visible rows", () => {
    renderTree();
    const notes = row("notes");
    notes.focus();
    fireEvent.keyDown(notes, { key: "End" });
    expect(document.activeElement).toBe(row("Welcome.md"));
    fireEvent.keyDown(row("Welcome.md"), { key: "Home" });
    expect(document.activeElement).toBe(row("notes"));
  });
});

describe("inline rename", () => {
  it("F2 opens the inline input and Enter commits the rename", () => {
    const { ops } = renderTree();
    const welcome = row("Welcome.md");
    welcome.focus();
    fireEvent.keyDown(welcome, { key: "F2" });
    const input = screen.getByLabelText("Name");
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input, { target: { value: "Hello.md" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.renameEntry).toHaveBeenCalledWith("Welcome.md", "Hello.md");
  });

  it("keeps the folder prefix when renaming a nested file", () => {
    const { ops } = renderTree();
    fireEvent.click(row("notes"));
    const ideas = row("notes/ideas.md");
    ideas.focus();
    fireEvent.keyDown(ideas, { key: "F2" });
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "plans.md" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.renameEntry).toHaveBeenCalledWith("notes/ideas.md", "notes/plans.md");
  });

  it("Escape cancels without renaming", () => {
    const { ops } = renderTree();
    const welcome = row("Welcome.md");
    welcome.focus();
    fireEvent.keyDown(welcome, { key: "F2" });
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "Nope.md" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(ops.renameEntry).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});

describe("inline create", () => {
  it("a pending root create renders the input and commits with .md appended", () => {
    const ops = makeOps();
    const handled = vi.fn();
    render(
      <FileTree
        entries={ENTRIES}
        openPath={null}
        onOpenFile={vi.fn()}
        ops={ops}
        pendingCreate={{ kind: "file", parentDir: "" }}
        onPendingCreateHandled={handled}
      />,
    );
    expect(handled).toHaveBeenCalled();
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "Fresh" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.createNote).toHaveBeenCalledWith("Fresh.md");
  });

  it("a folder create passes the name through untouched", () => {
    const ops = makeOps();
    render(
      <FileTree
        entries={ENTRIES}
        openPath={null}
        onOpenFile={vi.fn()}
        ops={ops}
        pendingCreate={{ kind: "dir", parentDir: "" }}
        onPendingCreateHandled={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "projects" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.createFolder).toHaveBeenCalledWith("projects");
  });
});

describe("the context menu", () => {
  it("opens from the row's actions button and starts a rename", async () => {
    renderTree();
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    const renameItem = await screen.findByText("Rename");
    fireEvent.click(renameItem);
    expect(await screen.findByLabelText("Name")).toBeDefined();
  });

  it("delete goes through ops.removeEntry", async () => {
    const { ops } = renderTree();
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    const deleteItem = await screen.findByText("Delete");
    fireEvent.click(deleteItem);
    expect(ops.removeEntry).toHaveBeenCalledWith("Welcome.md", "file");
  });

  it("a folder's menu offers New note and expands into an inline create", async () => {
    const { ops } = renderTree();
    fireEvent.click(screen.getByLabelText("Actions for notes"));
    const newNoteItem = await screen.findByText("New note");
    fireEvent.click(newNoteItem);
    const input = await screen.findByLabelText("Name");
    fireEvent.change(input, { target: { value: "inbox" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.createNote).toHaveBeenCalledWith("notes/inbox.md");
  });
});
