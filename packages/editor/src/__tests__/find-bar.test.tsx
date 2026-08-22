// @vitest-environment jsdom

// ⌘G's highlight is a decoration reading a module store, so this mounts the
// real kit and drives the store's own transforms — the match tint, the
// distinct active tint, and the cycle all assert on rendered leaves.

import { render } from "@testing-library/react";
import { act } from "react";
import { Plate, PlateContent, usePlateEditor, type PlateEditor } from "platejs/react";
import type { Value } from "platejs";
import { beforeAll, describe, expect, it } from "vitest";

import {
  collectFindMatches,
  cycleFindMatch,
  getFindBarState,
  openFindBar,
  setFindQuery,
} from "@repo/editor/find-bar";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";

type EditorHolder = { editor: PlateEditor | null };

function Harness({ value, holder }: { value: Value; holder: EditorHolder }) {
  const editor = usePlateEditor({ plugins: EDITOR_KIT, value });
  holder.editor = editor;
  return (
    <Plate editor={editor}>
      <PlateContent />
    </Plate>
  );
}

const VALUE: Value = [{ children: [{ text: "alpha beta ALPHA gamma" }], type: "p" }];

beforeAll(() => {
  // jsdom lays nothing out; the cycle's scroll is a no-op there.
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

describe("find bar", () => {
  it("highlights every case-insensitive match and tints the active one apart", () => {
    const holder: EditorHolder = { editor: null };
    const view = render(<Harness value={VALUE} holder={holder} />);
    const editor = holder.editor;
    expect(editor).not.toBeNull();
    if (editor === null) return;

    act(() => {
      openFindBar(editor);
      setFindQuery(editor, "alpha");
    });

    expect(collectFindMatches(editor, "alpha")).toHaveLength(2);
    expect(view.getByText("1/2")).toBeDefined();

    const leaves = [...view.container.querySelectorAll('[data-slate-leaf="true"]')];
    const activeLeaves = leaves.filter((leaf) => leaf.outerHTML.includes("orange"));
    const plainMatches = leaves.filter(
      (leaf) => leaf.outerHTML.includes("yellow") && !leaf.outerHTML.includes("orange"),
    );
    expect(activeLeaves).toHaveLength(1);
    expect(plainMatches).toHaveLength(1);
    expect(activeLeaves[0]?.textContent).toBe("alpha");
    expect(plainMatches[0]?.textContent).toBe("ALPHA");

    act(() => {
      cycleFindMatch(editor, 1);
    });
    const cycled = [...view.container.querySelectorAll('[data-slate-leaf="true"]')].filter((leaf) =>
      leaf.outerHTML.includes("orange"),
    );
    expect(cycled).toHaveLength(1);
    expect(cycled[0]?.textContent).toBe("ALPHA");

    act(() => {
      setFindQuery(editor, "");
    });
    expect(getFindBarState().active).toBeNull();
  });
});
