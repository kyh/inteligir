// @vitest-environment jsdom

import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import type { LibraryScope } from "@repo/domain/library-scope";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { SidebarProvider } from "@repo/ui/components/sidebar-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { stubRpc } from "../test-support/rpc-stub";
import { createWorkspaceQueryClient } from "../workspace-context";
import { ItemView } from "./item-view";

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
  id: null,
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

const itemsAtSchema = z.object({ paths: z.array(z.string()) });

// the index's rows by path; a path it lacks is no item
const stubIndex = (rows: readonly ItemRowWire[]) => {
  stubRpc({
    "knowledge/itemsAt": (input) => ({
      items: rows.filter((one) => itemsAtSchema.parse(input).paths.includes(one.path)),
    }),
    "system/status": () => ({
      agent: { state: "off" },
      dataDir: "/data",
      mediaToken: "boot-token",
      schemaVersion: 1,
      uptimeMs: 1,
      vaultDir: "/vault",
      version: "0.0.0",
    }),
  });
};

// the session's two publishes for an item: its path, then the bytes a doc loaded with
const openIn = (store: OpenNoteStore, path: string, content: string | null = null): void => {
  act(() => {
    store.publishOpenPath(path);
    if (content !== null) {
      store.publishEditor({
        content,
        dirty: false,
        diskSeq: 1,
        kind: "open",
        path,
        saveError: null,
      });
    }
  });
};

const mount = () => {
  installFakeEditorHost({});
  const store = createOpenNoteStore();
  const onGoToLibrary = vi.fn<(scope?: LibraryScope) => void>();
  const onReadHere = vi.fn<(path: string) => void>();
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <SidebarProvider>
        <ItemView
          store={store}
          lead={{
            canBack: false,
            canForward: false,
            onBack: vi.fn<() => void>(),
            onForward: vi.fn<() => void>(),
            onToggleRail: vi.fn<() => void>(),
            railOpen: true,
          }}
          insetTitleBar={false}
          zen={false}
          onGoToLibrary={onGoToLibrary}
          onFindInNote={vi.fn<() => void>()}
          annotationCount={0}
          onOpenAnnotations={vi.fn<() => void>()}
          onExportPdf={vi.fn<() => void>()}
          onReadHere={onReadHere}
        />
      </SidebarProvider>
    </QueryClientProvider>,
  );
  return { onGoToLibrary, onReadHere, store };
};

const stage = (): string | null =>
  document.querySelector<HTMLElement>("[data-item-stage]")?.dataset.itemStage ?? null;

describe("an item is shown by its kind", () => {
  it("shows a picture dropped on its own at its own address, carrying the boot's token", async () => {
    stubIndex([row("assets/photo.png", "image", { bare: true, file: "assets/photo.png" })]);
    const { store } = mount();
    openIn(store, "assets/photo.png");
    const image = await screen.findByRole("img", { name: "photo.png" });
    const src = new URL(image.getAttribute("src") ?? "");
    expect(src.searchParams.get("path")).toBe("assets/photo.png");
    expect(src.searchParams.get("m")).toBe("boot-token");
    expect(stage()).toBe("image");
  });

  it("shows the original a PDF item embeds in the system's viewer", async () => {
    stubIndex([row("Papers/Paper.md", "pdf", { file: "assets/Paper.pdf" })]);
    const { store } = mount();
    openIn(store, "Papers/Paper.md", "---\nkind: pdf\n---\n\n![[assets/Paper.pdf]]\n");
    const frame = await screen.findByTitle("Paper.pdf");
    expect(frame.getAttribute("src")).toMatch(/boot-token.*#view=FitH$/u);
    expect(stage()).toBe("pdf");
  });

  it("plays a video from the asset route, which the media loader asks by ranges", async () => {
    stubIndex([row("clip.mov", "video", { bare: true, file: "clip.mov" })]);
    const { store } = mount();
    openIn(store, "clip.mov");
    await waitFor(() => {
      expect(stage()).toBe("video");
    });
    expect(document.querySelector("video")?.getAttribute("src")).toContain("boot-token");
  });

  it("names a file the window cannot show, and its size", async () => {
    stubIndex([
      row("Budget.numbers", "file", { bare: true, file: "Budget.numbers", fileBytes: 2048 }),
    ]);
    const { store } = mount();
    openIn(store, "Budget.numbers");
    expect(await screen.findByText("2 KB")).toBeTruthy();
    expect(stage()).toBe("file");
  });

  it("opens a stub whose page is not read yet as its placeholder, never the editor, and reads it here when asked", async () => {
    stubIndex([
      row("Unsorted/example.com.md", "link", { pending: true, url: "https://example.com" }),
    ]);
    const { onReadHere, store } = mount();
    openIn(
      store,
      "Unsorted/example.com.md",
      "---\nid: 01J00000000000000000000000\nkind: link\nurl: https://example.com\nsaved: 2026-10-01T09:00:00Z\n---\n",
    );
    expect(await screen.findByText("Not read yet")).toBeTruthy();
    expect(stage()).toBe("pending");
    expect(document.querySelector("[data-editor-scroller]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Read it on this Mac/u }));
    expect(onReadHere).toHaveBeenCalledWith("Unsorted/example.com.md");
  });
});

describe("the way back to the library", () => {
  it("goes back on Escape from anywhere in the item that is not a field", async () => {
    stubIndex([row("assets/photo.png", "image", { bare: true, file: "assets/photo.png" })]);
    const { onGoToLibrary, store } = mount();
    openIn(store, "assets/photo.png");
    const image = await screen.findByRole("button", { name: "Show at actual size" });
    fireEvent.keyDown(image, { key: "Escape" });
    expect(onGoToLibrary).toHaveBeenCalledOnce();
  });

  it("takes the keyboard as it opens, so the first Escape goes back", async () => {
    stubIndex([row("assets/photo.png", "image", { bare: true, file: "assets/photo.png" })]);
    const { onGoToLibrary, store } = mount();
    openIn(store, "assets/photo.png");
    await screen.findByRole("button", { name: "Show at actual size" });
    const root = document.querySelector('[data-item-path="assets/photo.png"]');
    expect(document.activeElement).toBe(root);
    fireEvent.keyDown(root ?? document.body, { key: "Escape" });
    expect(onGoToLibrary).toHaveBeenCalledOnce();
  });

  it("goes back by the breadcrumb", async () => {
    stubIndex([row("assets/photo.png", "image", { bare: true, file: "assets/photo.png" })]);
    const { onGoToLibrary, store } = mount();
    openIn(store, "assets/photo.png");
    fireEvent.click(await screen.findByRole("button", { name: "Back to library" }));
    expect(onGoToLibrary).toHaveBeenCalled();
  });

  it("goes back when a file shown on its own is no item any more", async () => {
    stubIndex([]);
    const { onGoToLibrary, store } = mount();
    openIn(store, "assets/gone.png");
    await waitFor(() => {
      expect(onGoToLibrary).toHaveBeenCalledOnce();
    });
  });
});
