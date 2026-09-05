// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TreeOps } from "../file-tree";
import { RailTree } from "./rail-tree";
import { absoluteEntryPath } from "../tree-ops";

const ENTRIES: VaultEntry[] = [
  { kind: "dir", path: "notes" },
  { kind: "file", path: "notes/older.md", modifiedMs: 1_000 },
  { kind: "file", path: "notes/newest.md", modifiedMs: 3_000 },
  { kind: "file", path: "notes/middle.md", modifiedMs: 2_000 },
  { kind: "dir", path: "assets" },
  { kind: "file", path: "assets/logo.png" },
  { kind: "file", path: "Welcome.md", modifiedMs: 500 },
  { kind: "file", path: "Zed notes.md", modifiedMs: 4_000 },
];

const NO_PINS: ReadonlySet<string> = new Set();

function makeOps(): TreeOps {
  return {
    createNote: vi.fn(),
    createFolder: vi.fn(),
    renameEntry: vi.fn(),
    moveEntry: vi.fn(),
    removeEntry: vi.fn(),
    setPinned: vi.fn(),
  };
}

function renderTree(overrides: Partial<React.ComponentProps<typeof RailTree>> = {}) {
  const ops = makeOps();
  render(
    <RailTree
      entries={ENTRIES}
      loadState="loaded"
      onRetry={() => {}}
      openPath={null}
      onOpenFile={vi.fn()}
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
  return ops;
}

function visiblePaths(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-path]")].map(
    (row) => row.dataset["path"] ?? "",
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stubClipboard(): string[] {
  const copied: string[] = [];
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: (text: string) => {
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
  return copied;
}

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

describe("the filter", () => {
  it("shows the matches and the folders holding them, and nothing else", () => {
    renderTree({ filter: "mid" });
    expect(visiblePaths()).toEqual(["notes", "notes/middle.md"]);
  });

  it("matches a folder's own name", () => {
    renderTree({ filter: "asset" });
    expect(visiblePaths()).toEqual(["assets"]);
  });

  it("is a case-insensitive substring, and says when nothing matches", () => {
    renderTree({ filter: "WELCOME" });
    expect(visiblePaths()).toEqual(["Welcome.md"]);
    cleanup();
    renderTree({ filter: "zzz" });
    expect(visiblePaths()).toEqual([]);
    expect(screen.getByText("Nothing matches the filter.")).toBeDefined();
  });

  it("clearing it restores the folded tree", () => {
    const { rerender } = render(
      <RailTree
        entries={ENTRIES}
        loadState="loaded"
        onRetry={() => {}}
        openPath={null}
        onOpenFile={vi.fn()}
        ops={makeOps()}
        pendingCreate={null}
        onPendingCreateDone={() => {}}
        rootDir=""
        onMoveRequest={() => {}}
        pinnedPaths={NO_PINS}
        sort="name"
        vaultRoot={null}
        filter="mid"
      />,
    );
    expect(visiblePaths()).toEqual(["notes", "notes/middle.md"]);
    rerender(
      <RailTree
        entries={ENTRIES}
        loadState="loaded"
        onRetry={() => {}}
        openPath={null}
        onOpenFile={vi.fn()}
        ops={makeOps()}
        pendingCreate={null}
        onPendingCreateDone={() => {}}
        rootDir=""
        onMoveRequest={() => {}}
        pinnedPaths={NO_PINS}
        sort="name"
        vaultRoot={null}
        filter=""
      />,
    );
    expect(visiblePaths()).toEqual(["assets", "notes", "Welcome.md", "Zed notes.md"]);
  });
});

describe("the path rows", () => {
  it("copies the vault-relative path", async () => {
    const copied = stubClipboard();
    renderTree();
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    fireEvent.click(await screen.findByText("Copy path"));
    expect(copied).toEqual(["Welcome.md"]);
  });

  it("copies the absolute path only when the root is known", async () => {
    const copied = stubClipboard();
    renderTree({ vaultRoot: "/Users/me/vault" });
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    fireEvent.click(await screen.findByText("Copy absolute path"));
    expect(copied).toEqual(["/Users/me/vault/Welcome.md"]);
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

    const revealEntry = vi.fn();
    const openEntry = vi.fn();
    renderTree({ ops: { ...makeOps(), revealEntry, openEntry } });
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    fireEvent.click(await screen.findByText("Reveal in Finder"));
    expect(revealEntry).toHaveBeenCalledWith("Welcome.md");
    fireEvent.click(screen.getByLabelText("Actions for Welcome.md"));
    fireEvent.click(await screen.findByText("Open with default app"));
    expect(openEntry).toHaveBeenCalledWith("Welcome.md");
  });

  it("opens a folder with the default app no more than it reveals it", async () => {
    renderTree({ ops: { ...makeOps(), revealEntry: vi.fn(), openEntry: vi.fn() } });
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
