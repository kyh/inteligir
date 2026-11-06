import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlateEditor } from "platejs/react";

import { PICTURE_NOT_ADDED, takesPicture } from "@repo/editor/kits/image-kit";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "./test-support/editor-harness";

// oxlint-disable-next-line vitest/prefer-import-in-mock -- the stub stands in for sonner's toast alone, which the typed import() form refuses unless the whole module is stubbed
vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn<() => void>(), {
    error: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    success: vi.fn<() => void>(),
    warning: vi.fn<() => void>(),
  }),
}));

const { toast } = await import("@repo/ui/components/sonner");

const picture = (): File => new File([new Uint8Array(8)], "shot.png", { type: "image/png" });
const pdf = (): File => new File(["%PDF"], "a.pdf", { type: "application/pdf" });

describe("what the editor takes as a picture", () => {
  it("is a picture file, pasted or dropped", () => {
    expect(takesPicture({ files: [picture()], types: ["Files"] }, "paste")).toBe(true);
    expect(takesPicture({ files: [pdf(), picture()], types: ["Files"] }, "drop")).toBe(true);
  });

  it("is not a browser's copy of a web picture, whose markup the paste reads", () => {
    expect(takesPicture({ files: [picture()], types: ["Files", "text/html"] }, "paste")).toBe(
      false,
    );
    expect(takesPicture({ files: [picture()], types: ["Files", "text/html"] }, "drop")).toBe(true);
  });

  it("is not a file that is no picture, nor text", () => {
    expect(takesPicture({ files: [pdf()], types: ["Files"] }, "paste")).toBe(false);
    expect(takesPicture({ files: [], types: ["text/plain"] }, "drop")).toBe(false);
  });

  it("is refused in words that name no path or file system", () => {
    expect(PICTURE_NOT_ADDED).not.toMatch(/path|folder|vault|file/iu);
  });
});

// slate hands a paste to the plugins only over an editable target, which jsdom cannot draw (it has
// no isContentEditable); a drop it hands over from any target in the editor
describe("a picture dropped into a note's text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("is not added, and the editor says where a picture goes", () => {
    installFakeEditorHost();
    const ref = createRef<PlateEditor>();
    const view = render(
      <EditorHarness
        ref={ref}
        store={createOpenNoteStore()}
        value={[{ children: [{ text: "Before the picture." }], type: "p" }]}
      />,
    );
    const editable = view.container.querySelector("[data-slate-editor]");
    const editor = ref.current;
    if (!(editable instanceof HTMLElement) || editor === null) {
      throw new Error("the harness drew no editor");
    }
    const before = JSON.stringify(editor.children);

    const dropped = fireEvent.drop(editable, {
      dataTransfer: { files: [picture()], getData: () => "", types: ["Files"] },
    });

    expect(dropped, "the drop reached the browser's own handling").toBe(false);
    expect(toast.info).toHaveBeenCalledExactlyOnceWith(PICTURE_NOT_ADDED);
    expect(JSON.stringify(editor.children)).toBe(before);
  });
});
