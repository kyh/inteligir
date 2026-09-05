import { cleanup, fireEvent, render } from "@testing-library/react";
import { createSlateEditor, type Descendant, type TElement, type Value } from "platejs";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
import { serializeMd } from "@platejs/markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAgentRequestActions } from "@repo/editor/agent-request";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { TagChipKit } from "@repo/editor/kits/tag-chip-kit";
import { MD_STRINGIFY, parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { inlineTagSpans } from "@repo/notes/knowledge/link-extract";

afterEach(cleanup);
const showTag = vi.fn();
beforeEach(() => {
  showTag.mockClear();
  setAgentRequestActions({ askAboutSelection: vi.fn(), showTag });
});

// only TagChipKit: unregistered types still resolve through editor.getType's key fallback, which the suppression checks compare against.
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
  return [...container.querySelectorAll("[title^='Show notes tagged']")].map(
    (node) => node.textContent ?? "",
  );
}

describe("inlineTagSpans (the scanner the chip decorates with)", () => {
  it("finds letter-first tags, including nested and dashed names", () => {
    expect(inlineTagSpans("see #alpha and #a/b/c plus #kebab-case.")).toEqual([
      { end: 10, start: 4, tag: "alpha" },
      { end: 21, start: 15, tag: "a/b/c" },
      { end: 38, start: 27, tag: "kebab-case" },
    ]);
  });

  it("stops short of a trailing dash (the index trims it too)", () => {
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
    expect(container.textContent).toBe("todo #alpha and #beta");
  });

  it("clicking a chip asks the rail for that tag's notes", () => {
    const { container } = renderValue([paragraph([{ text: "todo #alpha" }])]);
    const chip = container.querySelector("[title^='Show notes tagged']");
    expect(chip).not.toBeNull();
    if (chip === null) return;
    fireEvent.click(chip);
    expect(showTag).toHaveBeenCalledWith("alpha");
  });

  it("skips inline code, code blocks and link labels (index parity)", () => {
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
    expect(JSON.stringify(parsed.value).includes("tagChip")).toBe(false);
  });
});
