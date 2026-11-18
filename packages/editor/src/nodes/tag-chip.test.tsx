import { fireEvent, render } from "@testing-library/react";
import { createSlateEditor } from "platejs";
import type { Descendant, TElement, Value } from "platejs";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
import { serializeMd } from "@platejs/markdown";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { TagChipKit } from "@repo/editor/kits/tag-chip-kit";
import { parseMarkdown } from "@repo/editor/headless/markdown/markdown-doc";
import { MD_STRINGIFY } from "@repo/editor/headless/markdown/md-plugins";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";

const showTag = vi.fn<(tag: string) => void>();
beforeEach(() => {
  showTag.mockClear();
  installFakeEditorHost({ agent: { askAboutSelection: vi.fn<(text: string) => void>(), showTag } });
});

// only TagChipKit: unregistered types still resolve through editor.getType's key fallback, which the suppression checks compare against.
const renderValue = (value: Value) => {
  const editor = createPlateEditor({ plugins: TagChipKit, value });
  return render(
    <Plate editor={editor}>
      <PlateContent />
    </Plate>,
  );
};

const paragraph = (children: Descendant[]): TElement => ({ children, type: "p" });

const chips = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("[title^='Show items tagged']")].map(
    (node) => node.textContent ?? "",
  );

describe("tag chip rendering", () => {
  it("chips every inline tag in a paragraph", () => {
    const { container } = renderValue([paragraph([{ text: "todo #alpha and #beta" }])]);
    expect(chips(container)).toStrictEqual(["#alpha", "#beta"]);
    expect(container.textContent).toBe("todo #alpha and #beta");
  });

  it("chips no tag longer than a line, which the index reads as text", () => {
    const long = "t".repeat(ITEM_FIELD_CAPS.line + 1);
    const { container } = renderValue([paragraph([{ text: `#alpha and #${long}` }])]);
    expect(chips(container)).toStrictEqual(["#alpha"]);
  });

  it("clicking a chip asks the rail for that tag's notes", () => {
    const { container } = renderValue([paragraph([{ text: "todo #alpha" }])]);
    const chip = container.querySelector("[title^='Show items tagged']");
    expect(chip).not.toBeNull();
    if (chip === null) {
      return;
    }
    fireEvent.click(chip);
    expect(showTag).toHaveBeenCalledWith("alpha");
  });

  it("skips inline code, code blocks and link labels (index parity)", () => {
    const cases: [string, Value][] = [
      ["inline code", [paragraph([{ code: true, text: "#alpha" }])]],
      [
        "code block",
        [{ children: [{ children: [{ text: "#alpha" }], type: "code_line" }], type: "code_block" }],
      ],
      ["link label", [paragraph([{ children: [{ text: "#alpha" }], type: "a", url: "/x" }])]],
    ];
    for (const [label, value] of cases) {
      const { container, unmount } = renderValue(value);
      expect(chips(container), label).toStrictEqual([]);
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
    if (!parsed.ok) {
      return;
    }
    const editor = createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
    const out = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
    expect(out).toBe(src);
    expect(JSON.stringify(parsed.value)).not.toContain("tagChip");
  });
});
