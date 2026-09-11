// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileTreeProps, TreeOps } from "../file-tree";
import { RailTree } from "./rail-tree";
import { absoluteEntryPath } from "../tree-ops";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  { kind: "file", modifiedMs: 1000, path: "notes/older.md" },
  { kind: "file", modifiedMs: 3000, path: "notes/newest.md" },
  { kind: "file", modifiedMs: 2000, path: "notes/middle.md" },
  { kind: "dir", path: "assets" },
  { kind: "file", path: "assets/logo.png" },
  { kind: "file", modifiedMs: 500, path: "Welcome.md" },
  { kind: "file", modifiedMs: 4000, path: "Zed notes.md" },
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

const renderTree = (overrides: Partial<React.ComponentProps<typeof RailTree>> = {}) => {
  const ops = makeOps();
  render(
    <RailTree
      entries={ENTRIES}
      loadState="loaded"
      onRetry={() => {}}
      openPath={null}
      onOpenFile={vi.fn<FileTreeProps["onOpenFile"]>()}
      ops={ops}
      pendingCreate={null}
      onPendingCreateDone={() => {}}
      rootDir=""
      onMoveRequest={() => {}}
      pinnedPaths={NO_PINS}
      sort="name"
      onSortChange={() => {}}
      vaultRoot={null}
      {...overrides}
    />,
  );
  return ops;
};

const visiblePaths = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-path]")].map((row) => row.dataset.path ?? "");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const stubClipboard = (): Mock<Clipboard["writeText"]> => {
  const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
};

describe("sorting", () => {
  it("by name keeps folders first, then files by name, case and digits aside", () => {
    renderTree();
    expect(visiblePaths()).toEqual(["assets", "notes", "Welcome.md", "Zed notes.md"]);
  });

  it("by modified keeps folders first and puts the newest file first inside each folder", () => {
    renderTree({ sort: "modified" });
    fireEvent.click(screen.getByText("notes"));
    expect(visiblePaths()).toEqual([
      "assets",
      "notes",
      "notes/newest.md",
      "notes/middle.md",
      "notes/older.md",
      "Zed notes.md",
      "Welcome.md",
    ]);
  });
});

describe("the path rows", () => {
  it("copies the vault-relative path", async () => {
    const writeText = stubClipboard();
    renderTree();
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    fireEvent.click(await screen.findByText("Copy path"));
    expect(writeText.mock.calls.flat()).toEqual(["Welcome.md"]);
  });

  it("copies the absolute path only when the root is known", async () => {
    const writeText = stubClipboard();
    renderTree({ vaultRoot: "/Users/me/vault" });
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    fireEvent.click(await screen.findByText("Copy absolute path"));
    expect(writeText.mock.calls.flat()).toEqual(["/Users/me/vault/Welcome.md"]);
    cleanup();
    renderTree();
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    await screen.findByText("Copy path");
    expect(screen.queryByText("Copy absolute path")).toBeNull();
  });

  it("offers Reveal and Open only when the shell wired them, and calls them", async () => {
    renderTree();
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    await screen.findByText("Copy path");
    expect(screen.queryByText("Reveal in Finder")).toBeNull();
    expect(screen.queryByText("Open with default app")).toBeNull();
    cleanup();

    const revealEntry = vi.fn<NonNullable<TreeOps["revealEntry"]>>();
    const openEntry = vi.fn<NonNullable<TreeOps["openEntry"]>>();
    renderTree({ ops: { ...makeOps(), openEntry, revealEntry } });
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    fireEvent.click(await screen.findByText("Reveal in Finder"));
    expect(revealEntry).toHaveBeenCalledWith("Welcome.md");
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    fireEvent.click(await screen.findByText("Open with default app"));
    expect(openEntry).toHaveBeenCalledWith("Welcome.md");
  });

  it("opens a folder with the default app no more than it reveals it", async () => {
    renderTree({
      ops: {
        ...makeOps(),
        openEntry: vi.fn<NonNullable<TreeOps["openEntry"]>>(),
        revealEntry: vi.fn<NonNullable<TreeOps["revealEntry"]>>(),
      },
    });
    fireEvent.click(screen.getByLabelText("Actions for notes"));
    await screen.findByText("Reveal in Finder");
    expect(screen.queryByText("Open with default app")).toBeNull();
  });
});

describe("the absolute path", () => {
  it("keeps the root's own separator", () => {
    expect(absoluteEntryPath("/Users/me/vault", "notes/a.md")).toBe("/Users/me/vault/notes/a.md");
    expect(absoluteEntryPath("C:\\Users\\me\\vault", "notes/a.md")).toBe(
      "C:\\Users\\me\\vault\\notes\\a.md",
    );
  });
});
