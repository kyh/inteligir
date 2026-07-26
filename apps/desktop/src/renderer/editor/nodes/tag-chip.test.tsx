// Inline `#tag` chips. Two things must hold, and the second is the one
// that would hurt: the chip must be CLICKABLE, and it must be RENDER-ONLY —
// a decoration that never reaches the document value, so a note's bytes are
// identical with the plugin registered and without it. Driven through the real
// registration (createPlateEditor + PlateContent, the embed-gate pattern) and
// the real EDITOR_KIT serializer, not by poking `decorate` by hand.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { createSlateEditor, type Descendant, type TElement, type Value } from "platejs";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
import { serializeMd } from "@platejs/markdown";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTags } from "@renderer/command/tags";
import { EDITOR_KIT } from "@renderer/editor/kits/editor-kit";
import { TagChipKit } from "@renderer/editor/kits/tag-chip-kit";
import { MD_STRINGIFY, parseMarkdown } from "@renderer/editor/markdown/markdown-doc";
import { inlineTagSpans } from "@repo/notes/knowledge/link-extract";

afterEach(cleanup);
beforeEach(() => useTags.setState({ request: null }));

/** Mount a value through the real TagChipKit registration. The other kits are
 * irrelevant here — unregistered element types still resolve to their default
 * type strings (`editor.getType` falls back to the key), which is exactly what
 * the suppression checks compare against. */
function renderValue(value: Value) {
  const editor = createPlateEditor({ plugins: TagChipKit, value });
  return render(
    <Plate editor={editor}>
      <PlateContent />
    </Plate>,
  );
}

function paragraph(children: Descendant[]): TElement {
  return { children, type: "p" };
}

function chips(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[title^='Browse notes tagged']")].map(
    (node) => node.textContent ?? "",
  );
}

// The chip decorates with the tag index's OWN scanner, so these assert the
// grammar the chip must highlight — the same tokens the index counted.
describe("inlineTagSpans (the scanner the chip decorates with)", () => {
  it("finds letter-first tags, including nested and dashed names", () => {
    expect(inlineTagSpans("see #alpha and #a/b/c plus #kebab-case.")).toEqual([
      { end: 10, start: 4, tag: "alpha" },
      { end: 21, start: 15, tag: "a/b/c" },
      { end: 38, start: 27, tag: "kebab-case" },
    ]);
  });

  it("stops short of a trailing dash (the index trims it too)", () => {
    // `#bar-` counts as the tag `bar`, so the chip must cover `#bar` only —
    // highlighting the dash would link a tag that isn't in the index.
    expect(inlineTagSpans("#bar-")).toEqual([{ end: 4, start: 0, tag: "bar" }]);
  });

  it("rejects the non-tag `#` shapes", () => {
    for (const text of ["C# rocks", "##heading", "#123", "#0d6efd", "see http://x/#frag", "# "]) {
      expect(inlineTagSpans(text), text).toEqual([]);
    }
  });
});

describe("tag chip rendering", () => {
  it("chips every inline tag in a paragraph", () => {
    const { container } = renderValue([paragraph([{ text: "todo #alpha and #beta" }])]);
    expect(chips(container)).toEqual(["#alpha", "#beta"]);
    // The surrounding prose is untouched text, not swallowed by the chip.
    expect(container.textContent).toBe("todo #alpha and #beta");
  });

  it("clicking a chip asks the palette to browse that tag", () => {
    const { container } = renderValue([paragraph([{ text: "todo #alpha" }])]);
    const chip = container.querySelector("[title^='Browse notes tagged']");
    expect(chip).not.toBeNull();
    if (chip === null) return;
    fireEvent.click(chip);
    expect(useTags.getState().request).toEqual({ kind: "browse", tag: "alpha" });
  });

  it("skips inline code, code blocks and link labels (index parity)", () => {
    // Each of these is text to Slate but NOT a tag to the index — a chip here
    // would navigate to an empty note list.
    const cases: Array<[string, Value]> = [
      ["inline code", [paragraph([{ code: true, text: "#alpha" }])]],
      [
        "code block",
        [{ children: [{ children: [{ text: "#alpha" }], type: "code_line" }], type: "code_block" }],
      ],
      ["link label", [paragraph([{ children: [{ text: "#alpha" }], type: "a", url: "/x" }])]],
    ];
    for (const [label, value] of cases) {
      const { container, unmount } = renderValue(value);
      expect(chips(container), label).toEqual([]);
      unmount();
    }
  });
});

describe("byte stability (the decoration never reaches the value)", () => {
  it("serializes tag-bearing markdown to its own bytes through EDITOR_KIT", () => {
    // The live editor's kit is the one carrying TagChipKit. If a chip ever
    // became a NODE instead of a decoration, this is what would break first —
    // and the round-trip fixture matrix right behind it.
    const src = [
      "Prose with #alpha and #a/b/c tags.",
      "",
      "`#notatag` in code, [#label](/x) in a link.",
      "",
      "```",
      "#alpha in a fence",
      "```",
      "",
      "- [ ] task #beta",
      "",
    ].join("\n");
    const parsed = parseMarkdown(src);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const editor = createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
    const out = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
    expect(out).toBe(src);
    // And the value itself carries no tagChip prop — decorations live outside
    // the document, so nothing can serialize them by accident.
    expect(JSON.stringify(parsed.value).includes("tagChip")).toBe(false);
  });
});
