import { fireEvent, render, screen } from "@testing-library/react";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
import { beforeEach, describe, expect, it } from "vitest";

import { RichBlocksKit } from "@repo/editor/kits/rich-blocks-kit";

import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

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

describe("an html block", () => {
  it("previews with no permissions at all, and scripts off", () => {
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const preview = screen.getByTitle("HTML preview");
    if (!(preview instanceof HTMLIFrameElement)) {
      throw new TypeError("the preview is not a frame");
    }
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("srcdoc")).toBe(PAYLOAD);
  });

  it("offers no way to run its script", () => {
    renderBlock();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });
});
