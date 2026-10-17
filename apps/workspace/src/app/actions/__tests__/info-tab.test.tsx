// @vitest-environment jsdom

import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import type { VaultStatusResponse } from "@repo/contract/local/vault/vault-schema";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { stubRpc } from "../../__tests__/rpc-stub";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { InfoTab } from "../info-tab";
import type { InfoActions, PanelSubject } from "../info-tab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = (path: string, kind: ItemKind, fields: Partial<ItemRowWire> = {}): ItemRowWire => ({
  author: null,
  bare: false,
  copy: null,
  cover: null,
  description: null,
  fetchError: null,
  fetched: null,
  file: null,
  fileBytes: null,
  folder: "",
  host: null,
  kind,
  modifiedMs: null,
  path,
  pending: false,
  pinned: false,
  preview: "",
  published: null,
  saved: null,
  site: null,
  tags: [],
  title: path,
  url: null,
  ...fields,
});

const STATUS: VaultStatusResponse = {
  conflicts: [],
  device: "This Mac",
  externalSync: null,
  lastError: null,
  lastSyncAt: null,
  state: "no-remote",
  tooLarge: { count: 1, files: [{ bytes: 12 * 1024 * 1024, path: "Lectures/talk.mov" }] },
};

const pathsSchema = z.object({ paths: z.array(z.string()) });

const stubWire = (rows: readonly ItemRowWire[]) => {
  stubRpc({
    "knowledge/itemsAt": (input) => ({
      items: rows.filter((one) => pathsSchema.parse(input).paths.includes(one.path)),
    }),
    "knowledge/scopes": () => ({
      folders: [{ items: 14, path: "Reading" }],
      total: 40,
      unsorted: 3,
      untagged: 9,
    }),
    "vault/status": () => STATUS,
  });
};

const infoActions = (): InfoActions => ({
  askAgent: vi.fn<InfoActions["askAgent"]>(),
  keepCopy: vi.fn<InfoActions["keepCopy"]>(),
  move: vi.fn<InfoActions["move"]>(),
  onRenameFolder: vi.fn<InfoActions["onRenameFolder"]>(),
  onRenameTag: vi.fn<InfoActions["onRenameTag"]>(),
  open: vi.fn<InfoActions["open"]>(),
  quickLook: vi.fn<InfoActions["quickLook"]>(),
  refresh: vi.fn<InfoActions["refresh"]>(),
  remove: vi.fn<InfoActions["remove"]>(),
  rename: vi.fn<InfoActions["rename"]>(),
  reveal: null,
  setPinned: vi.fn<InfoActions["setPinned"]>(),
  tag: vi.fn<InfoActions["tag"]>(),
  withSelection: vi.fn<InfoActions["withSelection"]>((run) => {
    run(["a.md", "b.md"]);
  }),
});

const mount = (subject: PanelSubject, selectionCount = 0) => {
  installFakeEditorHost({});
  const actions = infoActions();
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <InfoTab
        subject={subject}
        selectionCount={selectionCount}
        actions={actions}
        onOpenDoc={vi.fn<(path: string) => void>()}
      />
    </QueryClientProvider>,
  );
  return actions;
};

describe("Info about one item", () => {
  it("reads a file's facts from its index row, and offers its verbs", async () => {
    stubWire([
      row("Lectures/talk.mov", "video", {
        bare: true,
        file: "Lectures/talk.mov",
        folder: "Lectures",
        title: "talk",
      }),
    ]);
    const actions = mount({ kind: "item", path: "Lectures/talk.mov" });
    expect(await screen.findByText("talk")).toBeTruthy();
    expect(screen.getByText(/Lectures$/u)).toBeTruthy();
    // a file on its own carries no frontmatter to pin or describe it
    expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move…" }));
    expect(actions.move).toHaveBeenCalledWith(["Lectures/talk.mov"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.remove).toHaveBeenCalledWith(["Lectures/talk.mov"]);
  });

  it("says a file over the sync cap is only on this Mac", async () => {
    stubWire([row("Lectures/talk.mov", "video", { bare: true, file: "Lectures/talk.mov" })]);
    mount({ kind: "item", path: "Lectures/talk.mov" });
    expect(
      await screen.findByText("Only on this Mac: it is over 10 MB, so it is kept out of sync."),
    ).toBeTruthy();
  });

  it("says why a page was not read, and offers to read it again", async () => {
    stubWire([
      row("Unsorted/gone.md", "link", {
        bare: true,
        fetchError: "The page could not be reached.",
        url: "https://gone.example",
      }),
    ]);
    const actions = mount({ kind: "item", path: "Unsorted/gone.md" });
    expect(await screen.findByText("The page could not be reached.")).toBeTruthy();
    const [refresh] = screen.getAllByRole("button", { name: "Refresh from the page" });
    if (refresh === undefined) {
      throw new Error("a failed page offers its refresh");
    }
    fireEvent.click(refresh, { altKey: true });
    expect(actions.refresh).toHaveBeenCalledWith("Unsorted/gone.md", true);
  });

  it("says so when the path is no item", async () => {
    stubWire([]);
    mount({ kind: "item", path: "nowhere.md" });
    expect(await screen.findByText("This isn't in your library.")).toBeTruthy();
  });
});

describe("Info about many items, or a scope", () => {
  it("counts a selection and runs its verbs on the selection's paths", () => {
    stubWire([]);
    const actions = mount(
      { all: false, kind: "selection", paths: ["a.md", "b.md"], scope: { kind: "all" } },
      2,
    );
    expect(screen.getByText("2 items")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tag…" }));
    expect(actions.tag).toHaveBeenCalledWith(["a.md", "b.md"]);
  });

  it("counts a folder and offers its rename", async () => {
    stubWire([]);
    const actions = mount({ kind: "scope", scope: { kind: "folder", path: "Reading" } });
    expect(await screen.findByText("14 items")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rename folder…" }));
    expect(actions.onRenameFolder).toHaveBeenCalledWith("Reading");
  });

  it("offers a tag's rename", () => {
    stubWire([]);
    const actions = mount({ kind: "scope", scope: { kind: "tag", tag: "work" } });
    expect(screen.getByText("#work")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rename tag…" }));
    expect(actions.onRenameTag).toHaveBeenCalledWith("work");
  });
});
