import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { EditorHarness } from "./test-support/editor-harness.test-utils";

const STYLES = path.join(import.meta.dirname, "styles.css");

const p = (text: string) => ({ children: [{ text }], type: "p" });

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
  get types() {
    return [...this.written.keys()] satisfies readonly string[];
  }
  clearData = (format?: string) => {
    if (format === undefined) {
      this.written.clear();
    } else {
      this.written.delete(format);
    }
  };
  getData = (format: string) => this.written.get(format) ?? "";
  setData = (format: string, data: string) => {
    this.written.set(format, data);
  };
  setDragImage = () => {
    this.dropEffect = "copy";
  };
}

const copied = (editor: PlateEditor) => {
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
    render(<EditorHarness value={value} ref={ref} chunkSize={100} />);
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
