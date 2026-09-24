import { cleanup, fireEvent, render } from "@testing-library/react";
import { KEYS } from "platejs";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmbedKit } from "@repo/editor/kits/embed-kit";

afterEach(cleanup);

const renderNode = (type: string, url: string) => {
  const editor = createPlateEditor({
    plugins: EmbedKit,
    value: [{ children: [{ text: "" }], type, url }],
  });
  return render(
    <Plate editor={editor}>
      <PlateContent />
    </Plate>,
  );
};

const REMOTE = [
  [KEYS.mediaEmbed, "https://example.com/widget"],
  [KEYS.mediaEmbed, "http://example.com/widget"],
  [KEYS.mediaEmbed, "https://twitter.com/user/status/1234567890"],
  [KEYS.video, "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  [KEYS.video, "https://vimeo.com/76979871"],
  [KEYS.file, "https://example.com/paper.pdf"],
] as const;

// the page's CSP refuses every remote frame, so a live one would only ever draw broken.
describe("a remote embed is a card that loads nothing", () => {
  it.each(REMOTE)("%s %s mounts no frame and names itself unloaded", (type, url) => {
    const { container, getByText } = renderNode(type, url);
    expect(container.querySelector("iframe")).toBeNull();
    expect(getByText("Remote content, not loaded")).toBeDefined();
    expect(getByText(url)).toBeDefined();
  });

  it.each(REMOTE)("%s %s opens in the browser with no handle back to this window", (type, url) => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(renderNode(type, url).getByRole("button", { name: "Open in browser" }));
    expect(opened).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
    opened.mockRestore();
  });
});

describe("media_embed scheme gate", () => {
  it.each([
    // oxlint-disable-next-line no-script-url -- the blocked scheme is this test's input, not a live URL.
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "relative/page.html",
  ])("blocks %s — fallback text, no frame, nothing to open", (url) => {
    const { container, getByText, queryByRole } = renderNode(KEYS.mediaEmbed, url);
    expect(container.querySelector("iframe")).toBeNull();
    expect(getByText(url)).toBeDefined();
    expect(queryByRole("button", { name: "Open in browser" })).toBeNull();
  });
});

describe("file scheme gate", () => {
  it.each([
    // oxlint-disable-next-line no-script-url -- the blocked scheme is this test's input, not a live URL.
    "javascript:alert(1)//x.pdf",
    "data:application/pdf;base64,AAAA#x.pdf",
    "file:///tmp/secret.pdf",
    "assets/local.pdf",
  ])("blocks %s — inert card, no frame, no live href", (url) => {
    const { container, queryByRole } = renderNode(KEYS.file, url);
    expect(container.querySelector("iframe")).toBeNull();
    expect(queryByRole("button", { name: "Open in browser" })).toBeNull();
    for (const anchor of container.querySelectorAll("a")) {
      expect(anchor.getAttribute("href")).toBeNull();
    }
  });

  it("keeps the card href for a safe non-pdf http URL", () => {
    const url = "https://example.com/report.docx";
    const { container } = renderNode(KEYS.file, url);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(url);
  });
});
