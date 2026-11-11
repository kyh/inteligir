import { describe, expect, it } from "vitest";
import type { TElement } from "platejs";
import { YHistoryEditor } from "@slate-yjs/core";
import * as Y from "yjs";

import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { applyBodyChanges } from "@repo/editor/live/body-change";
import { readBlocks, seedDoc } from "@repo/editor/live/note-blocks";
import { liveEditor, relay, settle, syncedCopy } from "../test-support/live-notes";

const stored = (element: TElement & { readonly id: string }): LibraryBlock =>
  storableBlockSchema.parse(element);

const p = (id: string, text: string): LibraryBlock =>
  stored({ children: [{ text }], id, type: "p" });

const sectionsOf = (doc: Y.Doc): [string, LibrarySection][] =>
  readBlocks(doc).map(({ block, section }) => [block.id, section]);

// a person's device on a note whose page a fill read, beside the note's own editor
const clipped = () => {
  const seeded = new Y.Doc();
  seedDoc(seeded, [
    { block: p("mine", "my words"), section: "note" },
    { block: p("page", "the page"), section: "article" },
  ]);
  const deviceDoc = syncedCopy(seeded);
  const objectDoc = syncedCopy(seeded);
  const net = relay([deviceDoc, objectDoc]);
  const device = liveEditor(deviceDoc);
  const object = liveEditor(objectDoc, { history: false });
  return { device, deviceDoc, net, object, objectDoc };
};

describe("a block's section as the editor makes blocks", () => {
  it("files a line split off the article as the person's", () => {
    const { device, deviceDoc, net, object } = clipped();
    device.tf.splitNodes({ at: { offset: 3, path: [1, 0] } });
    settle(net, [device, object]);
    const [, page, split] = sectionsOf(deviceDoc);
    expect(page).toStrictEqual(["page", "article"]);
    expect(split?.[1]).toBe("note");
  });

  it("files a block inserted anywhere as the person's, one copied out of the article too", () => {
    const { device, deviceDoc, net, object } = clipped();
    const [, copied] = device.children;
    if (copied === undefined) {
      throw new Error("the article's block");
    }
    device.tf.insertNodes({ ...copied, id: "pasted" }, { at: [2] });
    device.tf.insertNodes({ children: [{ text: "typed" }], id: "typed", type: "p" }, { at: [1] });
    settle(net, [device, object]);
    expect(sectionsOf(deviceDoc)).toStrictEqual([
      ["mine", "note"],
      ["typed", "note"],
      ["page", "article"],
      ["pasted", "note"],
    ]);
  });

  it("puts an article's block back in the article on undo, the person's own and Plate's", () => {
    const { device, deviceDoc, net, object, objectDoc } = clipped();
    device.tf.removeNodes({ at: [1] });
    settle(net, [device, object]);
    expect(YHistoryEditor.isYHistoryEditor(device)).toBe(true);
    device.undo();
    settle(net, [device, object]);
    expect(sectionsOf(deviceDoc)).toStrictEqual([
      ["mine", "note"],
      ["page", "article"],
    ]);
    object.tf.removeNodes({ at: [1] });
    settle(net, [device, object]);
    object.tf.undo();
    settle(net, [device, object]);
    expect(sectionsOf(objectDoc)).toStrictEqual([
      ["mine", "note"],
      ["page", "article"],
    ]);
  });

  it("lands a block another editor placed in the article there", () => {
    const { device, deviceDoc, net, object, objectDoc } = clipped();
    expect(
      applyBodyChanges(object, [
        { afterId: "page", block: p("more", "more page"), kind: "insertAfter", section: "article" },
      ]),
    ).toStrictEqual({ kind: "applied" });
    settle(net, [device, object]);
    expect(sectionsOf(deviceDoc)).toStrictEqual(sectionsOf(objectDoc));
    expect(sectionsOf(deviceDoc).at(-1)).toStrictEqual(["more", "article"]);
  });

  it("seeds a block a fix makes in the section of the block it came from", () => {
    const doc = new Y.Doc();
    seedDoc(doc, [
      { block: p("mine", "my words"), section: "note" },
      {
        block: stored({
          children: [
            {
              children: [
                { children: [{ text: "one" }], type: "p" },
                { children: [{ text: "two" }], type: "p" },
              ],
              type: "column",
              width: "100%",
            },
          ],
          id: "lone",
          type: "column_group",
        }),
        section: "article",
      },
    ]);
    const read = readBlocks(doc);
    expect(read.map(({ block }) => block.type)).toStrictEqual(["p", "p", "p"]);
    expect(read.map(({ section }) => section)).toStrictEqual(["note", "article", "article"]);
  });
});
