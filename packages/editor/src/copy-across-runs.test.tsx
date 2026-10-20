// A copy of blocks from two runs of a long note writes the plain text it would of one: a run is a
// flow-root, no block to the copied text (styles.css), so no blank line lands at the run's edge.

import fs from "node:fs";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { EditorHarness } from "./test-support/editor-harness";

afterEach(cleanup);

const STYLES = path.join(import.meta.dirname, "styles.css");

const p = (text: string) => ({ children: [{ text }], type: "p" });

// jsdom has no DataTransfer: what a copy writes, by format
class RecordingTransfer implements DataTransfer {
  readonly written = new Map<string, string>();
  dropEffect: DataTransfer["dropEffect"] = "none";
  effectAllowed: DataTransfer["effectAllowed"] = "all";
  readonly files: FileList = {
    item: () => null,
    length: 0,
    [Symbol.iterator]: [][Symbol.iterator],
  };
  readonly items: DataTransferItemList = {
    add: () => null,
    clear: () => {},
    length: 0,
    remove: () => {},
    [Symbol.iterator]: [][Symbol.iterator],
  };
  get types(): readonly string[] {
    return [...this.written.keys()];
  }
  clearData = (format?: string): void => {
    if (format === undefined) {
      this.written.clear();
    } else {
      this.written.delete(format);
    }
  };
  getData = (format: string): string => this.written.get(format) ?? "";
  setData = (format: string, data: string): void => {
    this.written.set(format, data);
  };
  setDragImage = (): void => {
    this.dropEffect = "copy";
  };
}

const copied = (editor: PlateEditor): string => {
  const transfer = new RecordingTransfer();
  editor.tf.setFragmentData(transfer);
  return transfer.getData("text/plain");
};

describe("a copy across a long note's runs", () => {
  it("writes one line break between blocks, at a run's edge as anywhere", () => {
    const sheet = document.createElement("style");
    sheet.textContent = fs.readFileSync(STYLES, "utf-8");
    document.head.append(sheet);
    const value: Value = Array.from({ length: 150 }, (_, index) => p(`Block ${String(index)}`));
    const ref = createRef<PlateEditor>();
    render(<EditorHarness value={value} store={createOpenNoteStore()} ref={ref} chunkSize={100} />);
    const editor = ref.current;
    if (editor === null) {
      throw new Error("the editor did not mount");
    }
    expect(document.querySelectorAll("[data-slate-chunk]")).toHaveLength(2);

    editor.tf.select({ anchor: { offset: 0, path: [97, 0] }, focus: { offset: 5, path: [98, 0] } });
    const within = copied(editor);
    editor.tf.select({
      anchor: { offset: 0, path: [99, 0] },
      focus: { offset: 5, path: [100, 0] },
    });
    const across = copied(editor);
    sheet.remove();

    expect(within.replace("97", "x").replace("98", "y")).toBe(
      across.replace("99", "x").replace("100", "y"),
    );
    expect(across.split("\n").filter((line) => line === "")).toHaveLength(
      within.split("\n").filter((line) => line === "").length,
    );
  });
});
