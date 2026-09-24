// The comment surface's buffer half: marker insertion/removal as ordinary
// transactions, pairing into decorated ranges, and the serialized bytes those
// transactions produce — the dialect the sidecar's ids anchor into.

import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import { serializeMd } from "@platejs/markdown";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { MD_STRINGIFY } from "@repo/notes/markdown/md-plugins";
import { insertCommentMarkers, removeCommentMarkers } from "@repo/editor/comments/comment-markers";
import { commentSpans, holdsCommentMarkers } from "@repo/editor/comments/comment-ranges";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";

const editorWith = (md: string) => {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) {
    throw new Error("fixture must parse");
  }
  return createSlateEditor({ plugins: BASE_KIT, value: parsed.value });
};

const bytes = (editor: ReturnType<typeof editorWith>): string =>
  serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });

describe("comment markers", () => {
  it("wraps the selection with a pair that serializes as the dialect", () => {
    const editor = editorWith("The current layout needs review.\n");
    editor.selection = {
      anchor: { offset: 4, path: [0, 0] },
      focus: { offset: 18, path: [0, 0] },
    };
    expect(insertCommentMarkers(editor, "c1")).toBe(true);
    expect(bytes(editor)).toBe("The %%i:c1:start%%current layout%%i:c1:end%% needs review.\n");
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
      "A %%i:a,b:start%%shared range%%i:a,b:end%% and %%i:solo:start%%one%%i:solo:end%%.\n",
    );
    removeCommentMarkers(editor, ["a", "solo"]);
    expect(bytes(editor)).toBe("A %%i:b:start%%shared range%%i:b:end%% and one.\n");
  });
});

const spansOf = (md: string) => {
  const editor = editorWith(md);
  const spans = commentSpans(editor).map(({ extent, holder, ids, orphan }) => ({
    extent: extent === null ? null : editor.api.string(extent),
    holder: editor.children.indexOf(holder),
    ids,
    orphan,
  }));
  return { editor, spans };
};

describe("comment range pairing", () => {
  it("pairs a range and reads its ids", () => {
    const { editor, spans } = spansOf("x %%i:c1:start%%mid%%i:c1:end%% y\n");
    expect(spans).toEqual([{ extent: "mid", holder: 0, ids: ["c1"], orphan: false }]);
    const [block] = editor.children;
    expect(block !== undefined && holdsCommentMarkers(block)).toBe(true);
  });

  it("pairs a multi-root marker once", () => {
    const { spans } = spansOf("x %%i:a,b:start%%mid%%i:a,b:end%% y\n");
    expect(spans).toEqual([{ extent: "mid", holder: 0, ids: ["a", "b"], orphan: false }]);
  });

  it("surfaces a lone edge as an orphan over the block holding it", () => {
    const { spans } = spansOf("x %%i:c1:start%%never closed\n");
    expect(spans).toEqual([{ extent: "x never closed", holder: 0, ids: ["c1"], orphan: true }]);
  });

  it("pairs a range across two paragraphs and holds it at the block it starts in", () => {
    const { spans } = spansOf("first %%i:y:start%%para\n\nsecond para%%i:y:end%% tail\n");
    expect(spans).toEqual([{ extent: "parasecond para", holder: 0, ids: ["y"], orphan: false }]);
  });

  it("pairs markers on their own lines around a fence, the dialect's block comment", () => {
    const { spans } = spansOf("%%i:x:start%%\n```js\ncode\n```\n%%i:x:end%%\n");
    expect(spans).toEqual([{ extent: "code", holder: 0, ids: ["x"], orphan: false }]);
  });

  it("orphans a start that a second start with the same ids replaced", () => {
    const { spans } = spansOf("%%i:c1:start%%a\n\n%%i:c1:start%%b%%i:c1:end%%\n");
    expect(spans).toEqual([
      { extent: "a", holder: 0, ids: ["c1"], orphan: true },
      { extent: "b", holder: 1, ids: ["c1"], orphan: false },
    ]);
  });

  it("orphans an end with no start before it, even when a start follows", () => {
    const { spans } = spansOf("a%%i:c1:end%%\n\n%%i:c1:start%%b\n");
    expect(spans).toEqual([
      { extent: "a", holder: 0, ids: ["c1"], orphan: true },
      { extent: "b", holder: 1, ids: ["c1"], orphan: true },
    ]);
  });

  it("pairs once per document, until the document changes", () => {
    const editor = editorWith("x %%i:c1:start%%mid%%i:c1:end%% y\n");
    const first = commentSpans(editor);
    expect(commentSpans(editor)).toBe(first);
    editor.tf.insertText("!", { at: { offset: 0, path: [0, 0] } });
    expect(commentSpans(editor)).not.toBe(first);
  });
});
