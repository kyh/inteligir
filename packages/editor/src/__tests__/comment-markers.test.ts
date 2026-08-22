// The comment surface's buffer half: marker insertion/removal as ordinary
// transactions, pairing into decorated ranges, and the serialized bytes those
// transactions produce — the dialect the sidecar's ids anchor into.

import { describe, expect, it } from "vitest";
import { createSlateEditor, type TElement } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import {
  insertCommentMarkers,
  mintCommentId,
  removeCommentMarkers,
} from "@repo/editor/comments/comment-markers";
import { holdsCommentMarkers, scanBlockComments } from "@repo/editor/comments/comment-ranges";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";

function editorWith(md: string) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error("fixture must parse");
  return createSlateEditor({ plugins: BASE_KIT, value: parsed.value });
}

function bytes(editor: ReturnType<typeof editorWith>): string {
  return serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
}

describe("comment markers", () => {
  it("wraps the selection with a pair that serializes as the dialect", () => {
    const editor = editorWith("The current layout needs review.\n");
    editor.selection = {
      anchor: { offset: 4, path: [0, 0] },
      focus: { offset: 18, path: [0, 0] },
    };
    expect(insertCommentMarkers(editor, "c1")).toBe(true);
    expect(bytes(editor)).toBe("The %%m:c1:start%%current layout%%m:c1:end%% needs review.\n");
  });

  it("refuses a collapsed selection", () => {
    const editor = editorWith("word\n");
    editor.selection = {
      anchor: { offset: 2, path: [0, 0] },
      focus: { offset: 2, path: [0, 0] },
    };
    expect(insertCommentMarkers(editor, "c1")).toBe(false);
    expect(bytes(editor)).toBe("word\n");
  });

  it("strips a single-id pair whole and trims one id from a shared pair", () => {
    const editor = editorWith(
      "A %%m:a,b:start%%shared range%%m:a,b:end%% and %%m:solo:start%%one%%m:solo:end%%.\n",
    );
    removeCommentMarkers(editor, ["a", "solo"]);
    expect(bytes(editor)).toBe("A %%m:b:start%%shared range%%m:b:end%% and one.\n");
  });

  it("mints ids in the marker alphabet", () => {
    const id = mintCommentId();
    expect(id).toMatch(/^[a-z0-9]{10}$/);
  });
});

describe("comment range pairing", () => {
  function scanFirstBlock(md: string) {
    const editor = editorWith(md);
    const block = editor.children[0];
    if (block === undefined || !("children" in block)) throw new Error("no block");
    const element: TElement = block;
    expect(holdsCommentMarkers(element)).toBe(true);
    return scanBlockComments(editor, [element, [0]]);
  }

  it("pairs a range and reads its ids", () => {
    const scan = scanFirstBlock("x %%m:c1:start%%mid%%m:c1:end%% y\n");
    expect(scan.unpairedIds).toEqual([]);
    expect(scan.ranges).toHaveLength(1);
    expect(scan.ranges[0]?.ids).toEqual(["c1"]);
  });

  it("pairs a multi-root marker once", () => {
    const scan = scanFirstBlock("x %%m:a,b:start%%mid%%m:a,b:end%% y\n");
    expect(scan.ranges).toHaveLength(1);
    expect(scan.ranges[0]?.ids).toEqual(["a", "b"]);
  });

  it("surfaces a lone edge as unpaired", () => {
    const scan = scanFirstBlock("x %%m:c1:start%%never closed\n");
    expect(scan.ranges).toEqual([]);
    expect(scan.unpairedIds).toEqual(["c1"]);
  });
});
