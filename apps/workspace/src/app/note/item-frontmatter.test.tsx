// @vitest-environment jsdom

import { createORPCErrorFromJson } from "@orpc/client";
import { contentHashHex } from "@repo/contract/local/vault/vault-schema";
import type { VaultWriteRequest } from "@repo/contract/local/vault/vault-schema";
import { getLiveEditor } from "@repo/editor/live-editor";
import { MarkdownEditor } from "@repo/editor/markdown-editor";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { readFrontmatterRaw } from "@repo/editor/properties/properties-node";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { toast } from "@repo/ui/components/sonner";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { stubRpc } from "../test-support/rpc-stub";
import { editItemFields, retagItems } from "./item-frontmatter";
import type { RewriteNoteApi } from "./rewrite-note";

beforeEach(() => {
  installFakeEditorHost();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ITEM =
  "---\nid: 7d2f9e40\nkind: link\nurl: https://example.com/\nsaved: 2026-10-17T09:12:30Z\n---\n\nbody\n";

// the guarded rewrite's two calls over one file on disk
const diskApi = (
  disk: string,
  writes: VaultWriteRequest[],
  refuse: Error | null = null,
): RewriteNoteApi => ({
  vault: {
    read: async ({ path }) => ({ content: disk, path }),
    write: async (input) => {
      if (refuse !== null) {
        throw refuse;
      }
      writes.push(input);
      return { path: input.path };
    },
  },
});

// an api the live editor's path must never reach
const untouchedApi = (): RewriteNoteApi => ({
  vault: {
    read: async () => {
      throw new Error("the open item is edited in its buffer, never read from disk");
    },
    write: async () => {
      throw new Error("the open item is edited in its buffer, never written to disk");
    },
  },
});

const mountEditor = (path: string, value: string) =>
  render(
    <OpenNoteStoreProvider store={createOpenNoteStore()}>
      <MarkdownEditor path={path} value={value} onChange={vi.fn<(markdown: string) => void>()} />
    </OpenNoteStoreProvider>,
  );

describe("an item's field, written as a frontmatter line", () => {
  it("rewrites an item that is not open against the hash of what it read", async () => {
    const writes: VaultWriteRequest[] = [];
    const outcome = await editItemFields(diskApi(ITEM, writes), "Unsorted/a.md", {
      description: "A page worth keeping",
    });
    expect(outcome).toEqual({ kind: "done" });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.guard).toEqual({ hash: await contentHashHex(ITEM), kind: "expected" });
    expect(writes[0]?.content).toContain("description: A page worth keeping\n");
    expect(writes[0]?.content.endsWith("\n\nbody\n")).toBe(true);
  });

  it("reports an item that changed under the read, and merges nothing", async () => {
    const outcome = await editItemFields(
      diskApi(
        ITEM,
        [],
        // a refusal as the wire hands it over: a code the contract defines
        createORPCErrorFromJson({
          code: "CAS_MISMATCH",
          data: undefined,
          defined: true,
          message: "moved",
        }),
      ),
      "Unsorted/a.md",
      { description: "Late" },
    );
    expect(outcome).toEqual({
      kind: "refused",
      message: "Could not change Unsorted/a.md: it changed since it was read.",
    });
  });

  it("writes nothing when the item already says so", async () => {
    const writes: VaultWriteRequest[] = [];
    const outcome = await editItemFields(diskApi(ITEM, writes), "Unsorted/a.md", {
      url: "https://example.com/",
    });
    expect(outcome).toEqual({ kind: "unchanged" });
    expect(writes).toEqual([]);
  });

  it("edits the open item through its editor's frontmatter, so the autosave carries it", async () => {
    mountEditor("Unsorted/open.md", ITEM);
    const outcome = await editItemFields(untouchedApi(), "Unsorted/open.md", {
      description: "Edited live",
    });
    expect(outcome).toEqual({ kind: "done" });
    const editor = getLiveEditor("Unsorted/open.md");
    expect(editor === null ? null : readFrontmatterRaw(editor)).toContain(
      "description: Edited live",
    );
  });
});

const tagRequestSchema = z.object({
  add: z.array(z.string()),
  paths: z.array(z.string()),
  remove: z.array(z.string()),
});

describe("tags across items", () => {
  it("sends the items that are not open to the server's line edit, and warns of a conflict", async () => {
    const asked: z.infer<typeof tagRequestSchema>[] = [];
    stubRpc({
      "items/tag": (input) => {
        const request = tagRequestSchema.parse(input);
        asked.push(request);
        return {
          results: request.paths.map((path) => ({
            inline: path === "b.md" ? ["work"] : [],
            outcome: path === "c.md" ? "conflict" : "changed",
            path,
          })),
        };
      },
    });
    const warned = vi.spyOn(toast, "warning");
    const told = vi.spyOn(toast, "info");
    await retagItems(["a.md", "b.md", "c.md"], { add: ["reading"], remove: ["work"] });
    expect(asked).toEqual([
      { add: ["reading"], paths: ["a.md", "b.md", "c.md"], remove: ["work"] },
    ]);
    expect(warned).toHaveBeenCalledWith("1 item could not be tagged: changed or unreadable.");
    expect(told).toHaveBeenCalledWith("#work is written in the text");
  });

  it("tags the open item in its buffer, and the server never sees it", async () => {
    const asked: unknown[] = [];
    stubRpc({
      "items/tag": (input) => {
        asked.push(input);
        return { results: [] };
      },
    });
    mountEditor("Unsorted/open.md", ITEM);
    await retagItems(["Unsorted/open.md"], { add: ["later"], remove: [] });
    expect(asked).toEqual([]);
    const editor = getLiveEditor("Unsorted/open.md");
    expect(editor === null ? null : readFrontmatterRaw(editor)).toMatch(/tags:\n {2}- later/u);
  });
});
