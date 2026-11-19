import { describe, expect, it } from "vitest";
import { NodeApi, createSlateEditor } from "platejs";
import type { SlateEditor } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibrarySection } from "@repo/contract/library/library-nodes";

import { ReadOnlyGuardPlugin } from "@repo/editor/edit-guard";
import { blockChanges } from "./block-changes";
import { layBody } from "@repo/editor/headless/body/lay-body";
import { blocksOfValue, editorValueOf } from "@repo/editor/headless/body/note-blocks";
import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";

const p = (id: string, text: string, section: LibrarySection = "note") =>
  ({
    block: { children: [{ text }], id, type: "p" },
    section,
  }) satisfies BodyBlock;

const showing = (blocks: readonly BodyBlock[]) =>
  createSlateEditor({
    nodeId: true,
    plugins: [...BASE_KIT, ReadOnlyGuardPlugin],
    value: editorValueOf(blocks),
  });

const shown = (editor: SlateEditor) =>
  blocksOfValue(editor.children).map(
    ({ block, section }) => `${block.id}:${NodeApi.string(block)}:${section}`,
  );

const BASE = [p("one", "1"), p("two", "2"), p("three", "3")];

describe("a body laid over an editor showing another", () => {
  it("drops, puts, inserts and moves blocks by id until the editor holds the body", () => {
    const editor = showing(BASE);
    const body = [p("three", "3"), p("new", "fresh"), p("one", "1, changed")];
    expect(layBody(editor, body)).toBe(true);
    expect(shown(editor)).toStrictEqual(["three:3:note", "new:fresh:note", "one:1, changed:note"]);
  });

  it("moves a block into the section the body gives it", () => {
    const editor = showing(BASE);
    expect(layBody(editor, [p("one", "1"), p("two", "2", "article"), p("three", "3")])).toBe(true);
    expect(shown(editor)).toStrictEqual(["one:1:note", "two:2:article", "three:3:note"]);
  });

  it("stays out of the editor's undo, which still takes back the typing before it", () => {
    const editor = showing(BASE);
    editor.tf.insertText("!", { at: editor.api.end([0]) });
    expect(layBody(editor, [p("one", "1!"), p("two", "2"), p("three", "3, theirs")])).toBe(true);
    editor.undo();
    expect(shown(editor)).toStrictEqual(["one:1:note", "two:2:note", "three:3, theirs:note"]);
  });

  it("lands in an editor that takes no edit of the person's", () => {
    const editor = showing(BASE);
    editor.dom.readOnly = true;
    editor.tf.insertText("!", { at: editor.api.end([0]) });
    expect(shown(editor)).toStrictEqual(["one:1:note", "two:2:note", "three:3:note"]);
    expect(layBody(editor, [p("one", "1, theirs")])).toBe(true);
    expect(shown(editor)).toStrictEqual(["one:1, theirs:note"]);
  });

  it("changes nothing for the body the editor holds", () => {
    const editor = showing(BASE);
    expect(blockChanges(blocksOfValue(editor.children), BASE)).toStrictEqual([]);
    expect(layBody(editor, BASE)).toBe(true);
    expect(editor.history.undos).toStrictEqual([]);
  });
});
