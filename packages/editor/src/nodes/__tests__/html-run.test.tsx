import { fireEvent, render, screen } from "@testing-library/react";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RichBlocksKit } from "@repo/editor/kits/rich-blocks-kit";

import { FAKE_HTML_FRAME_URL, installFakeEditorHost } from "../../__tests__/fake-editor-host";

const PAYLOAD = "<!doctype html><button onclick=\"this.textContent='ran'\">go</button>";

beforeEach(() => {
  installFakeEditorHost();
});

const renderBlock = () => {
  const editor = createPlateEditor({
    plugins: RichBlocksKit,
    value: [{ children: [{ text: "" }], type: "html_block", value: PAYLOAD }],
  });
  return render(
    <Plate editor={editor}>
      <PlateContent />
    </Plate>,
  );
};

const frame = (title: string): HTMLIFrameElement => {
  const element = screen.getByTitle(title);
  if (!(element instanceof HTMLIFrameElement)) {
    throw new TypeError(`${title} is not a frame`);
  }
  return element;
};

describe("an html block's Run", () => {
  // a srcdoc frame inherits the page's `script-src 'self'`, so its inline script never runs.
  it("loads the host's html frame, not a srcdoc, and hands it the bytes once", () => {
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    const run = frame("HTML run");
    expect(run.getAttribute("src")).toBe(FAKE_HTML_FRAME_URL);
    expect(run.getAttribute("srcdoc")).toBeNull();
    expect(run.getAttribute("sandbox")).toBe("allow-scripts");

    const target = run.contentWindow;
    if (target === null) {
      throw new Error("the run frame has no window");
    }
    const posted = vi.spyOn(target, "postMessage");
    fireEvent.load(run);
    // the loader's write fires load again; the bytes must not be handed to what they became.
    fireEvent.load(run);
    expect(posted.mock.calls).toEqual([[PAYLOAD, "*"]]);
  });

  it("previews with no permissions at all, and scripts off", () => {
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const preview = frame("HTML preview");
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("srcdoc")).toBe(PAYLOAD);
  });
});
