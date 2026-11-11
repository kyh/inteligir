// @vitest-environment jsdom

import { createRef } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlateEditor } from "platejs/react";

import { fileSha } from "@repo/contract/library/file-sha";

import { fileNotKept, fileTooLarge, filesToKeep } from "@repo/editor/kits/image-kit";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import type { FakeEditorHostOptions } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "./test-support/editor-harness";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn<() => void>(), {
    error: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    success: vi.fn<() => void>(),
    warning: vi.fn<() => void>(),
  }),
}));

const { toast } = await import("@repo/ui/components/sonner");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const picture = (): File => new File([PNG], "shot.png", { type: "image/png" });
const pdf = (): File => new File(["%PDF-1.7"], "Lecture notes.pdf", { type: "application/pdf" });

// jsdom has no object URLs, and no isContentEditable, without which slate hands no paste on
beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:test/kept",
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
  Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest('[contenteditable="true"]') !== null;
    },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

afterAll(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  Reflect.deleteProperty(HTMLElement.prototype, "isContentEditable");
});

const mount = (options: FakeEditorHostOptions = {}) => {
  const host = installFakeEditorHost(options);
  const ref = createRef<PlateEditor>();
  const view = render(
    <EditorHarness
      ref={ref}
      value={[{ children: [{ text: "Before the picture." }], type: "p" }]}
    />,
  );
  const editable = view.container.querySelector("[data-slate-editor]");
  const editor = ref.current;
  if (!(editable instanceof HTMLElement) || editor === null) {
    throw new Error("the harness drew no editor");
  }
  editor.tf.select(editor.api.end([0]));
  return { editable, editor, host };
};

const transfer = (files: readonly File[], types = ["Files"]) => ({
  files,
  getData: () => "",
  types,
});

const blocksOf = (editor: PlateEditor) =>
  editor.children.map((block) => ({ name: block.name, sha: block.sha, type: block.type }));

describe("what the editor keeps from a paste or a drop", () => {
  it("is every file, pasted or dropped", () => {
    expect(filesToKeep(transfer([picture()]), "paste")).toHaveLength(1);
    expect(filesToKeep(transfer([pdf(), picture()]), "drop")).toHaveLength(2);
  });

  it("is not a browser's copy of a web picture, whose markup the paste reads", () => {
    expect(filesToKeep(transfer([picture()], ["Files", "text/html"]), "paste")).toStrictEqual([]);
    expect(filesToKeep(transfer([picture()], ["Files", "text/html"]), "drop")).toHaveLength(1);
  });

  it("is nothing for text alone", () => {
    expect(filesToKeep(transfer([], ["text/plain"]), "drop")).toStrictEqual([]);
  });

  it("refuses in words that name no path, folder or byte count", () => {
    expect(fileTooLarge("shot.png", 100 * 1024 * 1024)).toBe(
      "“shot.png” is larger than 100 MB, the most one file can be.",
    );
    expect(fileNotKept("shot.png")).not.toMatch(/path|folder|bytes/iu);
  });
});

describe("a picture pasted into a note's text", () => {
  it("is kept once, by its sha, and drawn from the bytes the host answers", async () => {
    const { editable, editor, host } = mount();

    const pasted = fireEvent.paste(editable, { clipboardData: transfer([picture()]) });

    expect(pasted, "the paste reached the browser's own handling").toBe(false);
    await waitFor(() => {
      expect(blocksOf(editor)).toContainEqual({ name: undefined, sha: fileSha(PNG), type: "img" });
    });
    expect(host.calls.filter((call) => call.action === "keepFile")).toStrictEqual([
      { action: "keepFile", args: [PNG, "image/png"] },
    ]);
    await waitFor(() => {
      expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:test/kept");
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("a file dropped into a note's text", () => {
  it("is kept and named in a file block", async () => {
    const { editable, editor } = mount();
    const dropped = fireEvent.drop(editable, { dataTransfer: transfer([pdf()]) });

    expect(dropped, "the drop reached the browser's own handling").toBe(false);
    await waitFor(() => {
      expect(blocksOf(editor)).toContainEqual({
        name: "Lecture notes.pdf",
        sha: fileSha(new TextEncoder().encode("%PDF-1.7")),
        type: "file",
      });
    });
  });

  it("whose type the browser cannot tell is kept as plain bytes and named in a file block", async () => {
    const { editable, editor, host } = mount();
    const sketch = new File(["x"], "plan.sketch");
    expect(sketch.type, "jsdom, as a browser, gives no type it does not know").toBe("");

    fireEvent.drop(editable, { dataTransfer: transfer([sketch]) });

    await waitFor(() => {
      expect(blocksOf(editor)).toContainEqual({
        name: "plan.sketch",
        sha: fileSha(new TextEncoder().encode("x")),
        type: "file",
      });
    });
    expect(
      host.calls.flatMap((call) =>
        call.action === "keepFile" ? [[[...call.args[0]], call.args[1]]] : [],
      ),
    ).toStrictEqual([[[...new TextEncoder().encode("x")], "application/octet-stream"]]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("several at the end of a block land in the order they came, the caret after the last", async () => {
    const { editable, editor } = mount();
    const one = new File(["%PDF-1.7 one"], "one.pdf", { type: "application/pdf" });
    const two = new File(["%PDF-1.7 two"], "two.pdf", { type: "application/pdf" });

    fireEvent.drop(editable, { dataTransfer: transfer([one, two]) });

    await waitFor(() => {
      expect(blocksOf(editor).filter((block) => block.type === "file")).toHaveLength(2);
    });
    expect(blocksOf(editor).map(({ name, type }) => [type, name])).toStrictEqual([
      ["p", undefined],
      ["file", "one.pdf"],
      ["file", "two.pdf"],
      ["p", undefined],
    ]);
    expect(editor.api.void(), "the caret is left in no file's hidden text").toBeUndefined();
    expect(editor.selection?.anchor.path).toStrictEqual([3, 0]);
  });

  it("past the library's size is refused in words, and none of it is read or kept", async () => {
    const { editable, editor, host } = mount({ fileMaxBytes: 4 });
    const before = JSON.stringify(editor.children);
    const big = picture();
    const read = vi.spyOn(big, "arrayBuffer");

    fireEvent.drop(editable, { dataTransfer: transfer([big]) });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(fileTooLarge("shot.png", 4));
    });
    expect(read).not.toHaveBeenCalled();
    expect(host.calls).toStrictEqual([]);
    expect(JSON.stringify(editor.children)).toBe(before);
  });

  it("that the host could not keep is refused in words, and nothing is inserted", async () => {
    const { editable, editor } = mount({
      keepFile: async () => await Promise.reject(new Error("the disk is full")),
    });
    const before = JSON.stringify(editor.children);

    fireEvent.drop(editable, { dataTransfer: transfer([picture()]) });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(fileNotKept("shot.png"));
    });
    expect(JSON.stringify(editor.children)).toBe(before);
  });
});
