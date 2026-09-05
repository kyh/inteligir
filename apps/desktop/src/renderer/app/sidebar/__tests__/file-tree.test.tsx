// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TreeOps } from "../file-tree";
import { RailTree } from "./rail-tree";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  { kind: "dir", path: "notes/daily" },
  { kind: "file", path: "notes/daily/2026-08-16.md" },
  { kind: "file", path: "notes/ideas.md" },
  { kind: "file", path: "Welcome.md" },
];

const NO_PINS: ReadonlySet<string> = new Set();

function makeOps(): TreeOps {
  return {
    createNote: vi.fn(),
    createFolder: vi.fn(),
    renameEntry: vi.fn(),
    moveEntry: vi.fn(),
    setPinned: vi.fn(),
    removeEntry: vi.fn(),
  };
}

// jsdom has no DataTransfer; the component writes to it and reads nothing back
function dataTransfer() {
  return { dataTransfer: { setData: vi.fn(), effectAllowed: "", dropEffect: "" } };
}

function dragTo(from: HTMLElement, to: HTMLElement): void {
  fireEvent.dragStart(from, dataTransfer());
  fireEvent.dragOver(to, dataTransfer());
  fireEvent.drop(to, dataTransfer());
}

interface RenderedTree {
  ops: TreeOps;
  onOpenFile: ReturnType<typeof vi.fn>;
}

function renderTree(overrides: Partial<React.ComponentProps<typeof RailTree>> = {}): RenderedTree {
  const ops = makeOps();
  const onOpenFile = vi.fn();
  render(
    <RailTree
      entries={ENTRIES}
      loadState="loaded"
      onRetry={() => {}}
      openPath={null}
      onOpenFile={onOpenFile}
      ops={ops}
      pendingCreate={null}
      onPendingCreateDone={() => {}}
      rootDir=""
      onMoveRequest={() => {}}
      pinnedPaths={NO_PINS}
      sort="name"
      filter=""
      vaultRoot={null}
      {...overrides}
    />,
  );
  return { ops, onOpenFile };
}

function createDir(): string | null {
  return document.querySelector("[data-create-dir]")?.getAttribute("data-create-dir") ?? null;
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

describe("a tree with no rows says WHY it has none", () => {
  it("calls an empty vault empty", () => {
    renderTree({ entries: [], loadState: "loaded" });
    expect(screen.getByText("The vault is empty.")).toBeDefined();
  });

  it("does not call a listing that has not answered yet empty", () => {
    renderTree({ entries: [], loadState: "loading" });
    expect(screen.queryByText("The vault is empty.")).toBeNull();
  });

  it("says a FAILED read failed, and offers the retry", () => {
    const onRetry = vi.fn();
    renderTree({ entries: [], loadState: "failed", onRetry });
    expect(screen.queryByText("The vault is empty.")).toBeNull();
    expect(screen.getByText("The vault could not be read.")).toBeDefined();
    fireEvent.click(screen.getByText("Try again"));
    expect(onRetry).toHaveBeenCalled();
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
    const onPendingCreateDone = vi.fn();
    const { ops } = renderTree({
      pendingCreate: { kind: "file", parentDir: "" },
      onPendingCreateDone,
    });
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "Fresh" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.createNote).toHaveBeenCalledWith("Fresh.md");
    expect(onPendingCreateDone).toHaveBeenCalled();
  });

  it("a cancelled create is reported done too", () => {
    const onPendingCreateDone = vi.fn();
    renderTree({ pendingCreate: { kind: "file", parentDir: "" }, onPendingCreateDone });
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
    expect(onPendingCreateDone).toHaveBeenCalled();
  });

  it("a folder create passes the name through untouched", () => {
    const { ops } = renderTree({ pendingCreate: { kind: "dir", parentDir: "" } });
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

describe("a listing rooted at a folder", () => {
  const scoped = ENTRIES.filter((entry) => entry.path.startsWith("notes/"));

  it("shows the folder's children as top-level rows", () => {
    renderTree({ entries: scoped, rootDir: "notes" });
    expect(row("notes/ideas.md").getAttribute("aria-level")).toBe("1");
    expect(screen.queryByText("notes")).toBeNull();
  });

  it("lands a root create inside the folder", () => {
    const { ops } = renderTree({
      entries: scoped,
      rootDir: "notes",
      pendingCreate: { kind: "file", parentDir: "notes" },
    });
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "todo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.createNote).toHaveBeenCalledWith("notes/todo.md");
  });
});

describe("where a create from outside the tree lands", () => {
  it("is the selected folder, or the selected file's, else the root", () => {
    renderTree();
    expect(createDir()).toBe("");
    fireEvent.click(row("notes"));
    expect(createDir()).toBe("notes");
    fireEvent.click(row("notes/ideas.md"));
    expect(createDir()).toBe("notes");
    fireEvent.click(row("Welcome.md"));
    expect(createDir()).toBe("");
  });
});

describe("moving by drag and drop", () => {
  it("drops a note into a folder", () => {
    const { ops } = renderTree();
    dragTo(row("Welcome.md"), row("notes"));
    expect(ops.moveEntry).toHaveBeenCalledWith("Welcome.md", "notes");
  });

  it("a note dropped beside another lands in that note's folder", () => {
    const { ops } = renderTree({ openPath: "notes/ideas.md" });
    dragTo(row("Welcome.md"), row("notes/ideas.md"));
    expect(ops.moveEntry).toHaveBeenCalledWith("Welcome.md", "notes");
  });

  it("refuses a folder dropped on itself, inside itself, or a note on its own folder", () => {
    const { ops } = renderTree({ openPath: "notes/daily/2026-08-16.md" });
    dragTo(row("notes"), row("notes"));
    dragTo(row("notes"), row("notes/daily"));
    dragTo(row("notes/ideas.md"), row("notes"));
    expect(ops.moveEntry).not.toHaveBeenCalled();
  });

  it("a refused row does not fall through to the root", () => {
    const { ops } = renderTree({ openPath: "notes/ideas.md" });
    fireEvent.dragStart(row("notes/ideas.md"), dataTransfer());
    fireEvent.dragOver(row("notes"), dataTransfer());
    fireEvent.drop(row("notes"), dataTransfer());
    expect(ops.moveEntry).not.toHaveBeenCalled();
  });

  it("drops on the empty area into the listing's root", () => {
    const { ops } = renderTree({ openPath: "notes/ideas.md" });
    dragTo(row("notes/ideas.md"), screen.getByRole("tree"));
    expect(ops.moveEntry).toHaveBeenCalledWith("notes/ideas.md", "");
  });

  it("a scoped listing's empty area is the scope, not the vault root", () => {
    const { ops } = renderTree({
      entries: ENTRIES.filter((entry) => entry.path.startsWith("notes/")),
      rootDir: "notes",
      openPath: "notes/daily/2026-08-16.md",
    });
    dragTo(row("notes/daily/2026-08-16.md"), screen.getByRole("tree"));
    expect(ops.moveEntry).toHaveBeenCalledWith("notes/daily/2026-08-16.md", "notes");
  });

  it("offers Move to… in the row menu when a picker is wired", async () => {
    const onMoveRequest = vi.fn();
    renderTree({ onMoveRequest });
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    fireEvent.click(await screen.findByText("Move to…"));
    expect(onMoveRequest).toHaveBeenCalledWith("Welcome.md");
  });
});

describe("collapse all", () => {
  it("folds every folder", () => {
    renderTree({ openPath: "notes/daily/2026-08-16.md" });
    expect(screen.getByText("2026-08-16.md")).toBeDefined();
    fireEvent.click(screen.getByText("Collapse all"));
    expect(screen.queryByText("2026-08-16.md")).toBeNull();
    expect(screen.queryByText("daily")).toBeNull();
  });
});

describe("the row menu's pin verb", () => {
  it("pins an unpinned note and unpins a pinned one, through ops.setPinned", async () => {
    const { ops } = renderTree({ pinnedPaths: new Set(["Welcome.md"]) });
    fireEvent.contextMenu(row("Welcome.md"));
    fireEvent.click(await screen.findByText("Unpin"));
    expect(ops.setPinned).toHaveBeenCalledWith("Welcome.md", false);
    fireEvent.click(row("notes"));
    fireEvent.contextMenu(row("notes/ideas.md"));
    fireEvent.click(await screen.findByText("Pin"));
    expect(ops.setPinned).toHaveBeenCalledWith("notes/ideas.md", true);
  });

  it("offers no pin on a folder", async () => {
    renderTree();
    fireEvent.contextMenu(row("notes"));
    expect(await screen.findByText("Rename")).toBeDefined();
    expect(screen.queryByText("Pin")).toBeNull();
  });
});
