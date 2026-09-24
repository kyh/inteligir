// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileTreeProps, TreeOps } from "../file-tree";
import { RailTree } from "./rail-tree";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  { kind: "dir", path: "notes/daily" },
  { kind: "file", path: "notes/daily/2026-08-16.md" },
  { kind: "file", path: "notes/ideas.md" },
  { kind: "file", path: "Welcome.md" },
];

const NO_PINS: ReadonlySet<string> = new Set();

const makeOps = (): TreeOps => ({
  createFolder: vi.fn<TreeOps["createFolder"]>(),
  createNote: vi.fn<TreeOps["createNote"]>(),
  moveEntry: vi.fn<TreeOps["moveEntry"]>(),
  removeEntry: vi.fn<TreeOps["removeEntry"]>(),
  renameEntry: vi.fn<TreeOps["renameEntry"]>(),
  setPinned: vi.fn<TreeOps["setPinned"]>(),
});

// jsdom has no DataTransfer; the component writes to it and reads nothing back
const dataTransfer = () => ({
  dataTransfer: { dropEffect: "", effectAllowed: "", setData: vi.fn() },
});

const dragTo = (from: HTMLElement, to: HTMLElement): void => {
  fireEvent.dragStart(from, dataTransfer());
  fireEvent.dragOver(to, dataTransfer());
  fireEvent.drop(to, dataTransfer());
};

type RailTreeOverrides = Partial<React.ComponentProps<typeof RailTree>>;

interface RenderedTree {
  ops: TreeOps;
  onOpenFile: ReturnType<typeof vi.fn>;
  // the same tree drawn again over other props, as the rail's next render would
  rerender: (overrides: RailTreeOverrides) => void;
}

const renderTree = (overrides: RailTreeOverrides = {}): RenderedTree => {
  const ops = makeOps();
  const onOpenFile = vi.fn<FileTreeProps["onOpenFile"]>();
  const tree = (props: RailTreeOverrides) => (
    <RailTree
      entries={ENTRIES}
      loadState="loaded"
      onRetry={() => {}}
      openPath={null}
      onOpenFile={onOpenFile}
      ops={ops}
      onMoveRequest={() => {}}
      pinnedPaths={NO_PINS}
      sort="name"
      onSortChange={() => {}}
      vaultRoot={null}
      {...props}
    />
  );
  const rendered = render(tree(overrides));
  return {
    onOpenFile,
    ops,
    rerender: (next) => {
      rendered.rerender(tree({ ...overrides, ...next }));
    },
  };
};

// the rail's New note, named and committed: the path the create asked for
const createFromRail = (ops: TreeOps): string | undefined => {
  fireEvent.click(screen.getByText("Rail new note"));
  const input = screen.getByLabelText("Name");
  fireEvent.change(input, { target: { value: "Fresh" } });
  fireEvent.keyDown(input, { key: "Enter" });
  return vi.mocked(ops.createNote).mock.lastCall?.[0];
};

const row = (path: string): HTMLElement => {
  const element = document.querySelector(`[data-path="${path}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no row for ${path}`);
  }
  return element;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it("expands to the open note without setting the rail's state during the tree's render", () => {
    const logged = vi.spyOn(console, "error");
    renderTree({ openPath: "notes/daily/2026-08-16.md" });
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("a reveal from the breadcrumb", () => {
  it("opens the way to a folder, opens the folder and focuses its row", () => {
    const { ops } = renderTree({ reveal: { nonce: 1, path: "notes/daily" } });
    expect(screen.getByText("2026-08-16.md")).toBeDefined();
    expect(document.activeElement).toBe(row("notes/daily"));
    expect(createFromRail(ops)).toBe("notes/daily/Fresh.md");
  });

  it("is consumed, so a rail mounted again re-applies neither the focus nor the selection", () => {
    const { ops } = renderTree({ reveal: { nonce: 1, path: "notes/daily" } });
    expect(document.activeElement).toBe(row("notes/daily"));
    fireEvent.click(screen.getByText("Rail toggle"));
    fireEvent.click(screen.getByText("Rail toggle"));
    expect(document.activeElement).toBe(document.body);
    expect(screen.queryByText("daily")).toBeNull();
    expect(createFromRail(ops)).toBe("Fresh.md");
  });

  it("is focused once, so a tree mounted again for a create keeps the input's focus", () => {
    const { ops } = renderTree({ reveal: { nonce: 1, path: "notes" } });
    expect(document.activeElement).toBe(row("notes"));
    fireEvent.click(screen.getByText("Rail other view"));
    fireEvent.click(screen.getByText("Rail new note"));
    const input = screen.getByLabelText("Name");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Fresh" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.createNote).toHaveBeenCalledWith("notes/Fresh.md");
  });

  it("leaves an open name input its focus when the two land together", () => {
    renderTree({ reveal: { nonce: 1, path: "notes" }, startHidden: true });
    fireEvent.click(screen.getByText("Rail new note"));
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
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
    const onRetry = vi.fn<FileTreeProps["onRetry"]>();
    renderTree({ entries: [], loadState: "failed", onRetry });
    expect(screen.queryByText("The vault is empty.")).toBeNull();
    expect(screen.getByText("The vault could not be read.")).toBeDefined();
    fireEvent.click(screen.getByText("Try again"));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("keyboard navigation", () => {
  it("has exactly one tab stop, the container included (roving tabindex)", () => {
    renderTree();
    const tree = screen.getByRole("tree");
    const stops = [tree, ...tree.querySelectorAll("*")].filter(
      (element) => element.getAttribute("tabindex") === "0",
    );
    expect(stops).toEqual([row("notes")]);
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
  it("the rail's create renders the input and commits with .md appended", () => {
    const { ops } = renderTree();
    fireEvent.click(screen.getByText("Rail new note"));
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "Fresh" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.createNote).toHaveBeenCalledWith("Fresh.md");
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("a name with a dot in it is a title, so it still becomes a note", () => {
    const { ops } = renderTree();
    fireEvent.click(screen.getByText("Rail new note"));
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "Node.js" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.createNote).toHaveBeenCalledWith("Node.js.md");
  });

  it("keeps a doc extension the name already carries", () => {
    const { ops } = renderTree();
    fireEvent.click(screen.getByText("Rail new note"));
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "todo.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.createNote).toHaveBeenCalledWith("todo.txt");
  });

  it("a cancelled create ends it", () => {
    const { ops } = renderTree();
    fireEvent.click(screen.getByText("Rail new note"));
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(ops.createNote).not.toHaveBeenCalled();
  });

  it("a create in a folded folder opens it, so the input is in the first paint", () => {
    renderTree();
    fireEvent.click(row("notes"));
    fireEvent.click(row("notes"));
    expect(screen.queryByText("ideas.md")).toBeNull();
    fireEvent.click(screen.getByText("Rail new note"));
    expect(screen.getByLabelText("Name")).toBeDefined();
    expect(screen.getByText("ideas.md")).toBeDefined();
  });

  it("a create in a folder folded away by Collapse all opens the way to it", () => {
    renderTree();
    fireEvent.click(row("notes"));
    fireEvent.click(row("notes/daily"));
    fireEvent.click(screen.getByText("Collapse all"));
    expect(screen.queryByText("daily")).toBeNull();
    fireEvent.click(screen.getByText("Rail new note"));
    expect(screen.getByLabelText("Name")).toBeDefined();
  });

  it("a folder create passes the name through untouched", async () => {
    const { ops } = renderTree();
    fireEvent.contextMenu(screen.getByRole("tree"));
    fireEvent.click(await screen.findByText("New folder"));
    const input = await screen.findByLabelText("Name");
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

describe("where a create from outside the tree lands", () => {
  it("is the selected folder, or the selected file's, else the root", () => {
    const { ops } = renderTree();
    expect(createFromRail(ops)).toBe("Fresh.md");
    fireEvent.click(row("notes"));
    expect(createFromRail(ops)).toBe("notes/Fresh.md");
    fireEvent.click(row("notes/ideas.md"));
    expect(createFromRail(ops)).toBe("notes/Fresh.md");
    fireEvent.click(row("Welcome.md"));
    expect(createFromRail(ops)).toBe("Fresh.md");
  });

  it("follows a rename to its new path across a listing that only restamps times", () => {
    const { ops, rerender } = renderTree();
    fireEvent.click(row("notes"));
    const daily = row("notes/daily");
    daily.focus();
    fireEvent.keyDown(daily, { key: "F2" });
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "journal" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.renameEntry).toHaveBeenCalledWith("notes/daily", "notes/journal");

    rerender({
      entries: ENTRIES.map((entry) =>
        entry.kind === "file" ? { ...entry, modifiedMs: 1000 } : entry,
      ),
    });
    rerender({
      entries: ENTRIES.map((entry) => ({
        ...entry,
        path: entry.path.replace(/^notes\/daily/u, "notes/journal"),
      })),
    });

    expect(createFromRail(ops)).toBe("notes/journal/Fresh.md");
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

  it("offers Move to… in the row menu when a picker is wired", async () => {
    const onMoveRequest = vi.fn<FileTreeProps["onMoveRequest"]>();
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
