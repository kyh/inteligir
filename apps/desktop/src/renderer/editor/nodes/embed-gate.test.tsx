// Scheme-gate tests for the note-authored embed/pdf iframes: a note is
// untrusted content, so only http(s) URLs may ever reach a live frame — a
// javascript:/data:/file:/relative URL renders a blocked fallback, never an
// iframe. Mounted through the REAL EmbedKit registration (createPlateEditor +
// PlateContent) so the assertions cover the components the editor actually
// renders.

import { cleanup, render } from "@testing-library/react";
import { KEYS } from "platejs";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmbedKit } from "@renderer/editor/kits/embed-kit";

afterEach(cleanup);

function renderNode(type: string, url: string) {
  const editor = createPlateEditor({
    plugins: EmbedKit,
    value: [{ children: [{ text: "" }], type, url }],
  });
  return render(
    <Plate editor={editor}>
      <PlateContent />
    </Plate>,
  );
}

describe("media_embed scheme gate", () => {
  it.each(["https://example.com/widget", "http://example.com/widget"])(
    "renders an iframe for %s",
    (url) => {
      const { container } = renderNode(KEYS.mediaEmbed, url);
      const frame = container.querySelector("iframe");
      expect(frame).not.toBeNull();
      expect(frame?.getAttribute("src")).toBe(url);
    },
  );

  it("sandboxes the frame to allow-scripts only (no popups, no same-origin)", () => {
    const { container } = renderNode(KEYS.mediaEmbed, "https://example.com/widget");
    expect(container.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "relative/page.html",
  ])("blocks %s — fallback text, no iframe", (url) => {
    const { container, getByText } = renderNode(KEYS.mediaEmbed, url);
    expect(container.querySelector("iframe")).toBeNull();
    expect(getByText(url)).toBeDefined();
  });
});

describe("file (pdf) scheme gate", () => {
  it("renders the viewer iframe for an http(s) pdf URL", () => {
    const url = "https://example.com/paper.pdf";
    const { container } = renderNode(KEYS.file, url);
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(url);
  });

  it.each([
    "javascript:alert(1)//x.pdf",
    "data:application/pdf;base64,AAAA#x.pdf",
    "file:///tmp/secret.pdf",
    "assets/local.pdf",
  ])("blocks %s — inert card, no iframe, no live href", (url) => {
    const { container } = renderNode(KEYS.file, url);
    expect(container.querySelector("iframe")).toBeNull();
    // The fallback card must not carry the unsafe scheme as a clickable href.
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
