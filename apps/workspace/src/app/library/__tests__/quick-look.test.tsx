// @vitest-environment jsdom

import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { stubRpc } from "../../__tests__/rpc-stub";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { QuickLook } from "../quick-look";
import type { QuickLookProps } from "../quick-look";

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

const ROWS: readonly ItemRowWire[] = [
  row("Tides.md", "note", { title: "Tides" }),
  row("Unsorted/essay.md", "link", {
    host: "example.com",
    site: "Example",
    title: "An essay",
    url: "https://example.com/essay",
  }),
  row("photo.png", "image", { bare: true, file: "photo.png", title: "photo" }),
  row("Unsorted/later.md", "link", { pending: true, url: "https://later.example" }),
];

const BYTES = new Map([
  ["Tides.md", "# Tides\n\nThe moon pulls the sea.\n"],
  [
    "Unsorted/essay.md",
    "---\nkind: link\nurl: https://example.com/essay\n---\n\nThe essay's text.\n",
  ],
]);

const pathsSchema = z.object({ paths: z.array(z.string()) });
const readSchema = z.object({ path: z.string() });

const stubWire = () => {
  stubRpc({
    "knowledge/itemsAt": (input) => ({
      items: ROWS.filter((one) => pathsSchema.parse(input).paths.includes(one.path)),
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
    "vault/read": (input) => {
      const { path } = readSchema.parse(input);
      return { content: BYTES.get(path) ?? "", path, sha: "a".repeat(40) };
    },
  });
};

const mount = (path: string) => {
  installFakeEditorHost({});
  stubWire();
  const props: QuickLookProps = {
    onClose: vi.fn<() => void>(),
    onOpen: vi.fn<(path: string) => void>(),
    onStep: vi.fn<(path: string, by: -1 | 1) => void>(),
    path,
  };
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <QuickLook {...props} />
    </QueryClientProvider>,
  );
  return props;
};

describe("a look at a card", () => {
  it("draws a note read-only over its bytes", async () => {
    mount("Tides.md");
    expect(await screen.findByText("The moon pulls the sea.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Tides" })).toBeTruthy();
    expect(document.querySelector("[contenteditable=true]")).toBeNull();
  });

  it("draws a saved page under its source", async () => {
    mount("Unsorted/essay.md");
    expect(await screen.findByText("The essay's text.")).toBeTruthy();
    expect(screen.getByText("Example")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open original/u })).toBeTruthy();
  });

  it("shows a picture on its own stage", async () => {
    mount("photo.png");
    const image = await screen.findByRole("img", { name: "photo.png" });
    expect(new URL(image.getAttribute("src") ?? "").searchParams.get("m")).toBe("boot-token");
  });

  it("shows a stub's placeholder while its page is read", async () => {
    mount("Unsorted/later.md");
    expect(await screen.findByText("Filling in…")).toBeTruthy();
  });
});

describe("the keys inside a look", () => {
  it("steps along the grid with the arrows, opens with Enter and closes with Space", async () => {
    const props = mount("Tides.md");
    await screen.findByText("The moon pulls the sea.");
    const dialog = screen.getByRole("dialog", { name: "Tides" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(props.onStep).toHaveBeenNthCalledWith(1, "Tides.md", 1);
    expect(props.onStep).toHaveBeenNthCalledWith(2, "Tides.md", -1);
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(props.onOpen).toHaveBeenCalledWith("Tides.md");
    fireEvent.keyDown(dialog, { key: " " });
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
