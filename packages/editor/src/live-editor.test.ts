import { createSlateEditor } from "platejs";
import { afterEach, describe, expect, it } from "vitest";

import { getLiveEditor, liveEditorItemId, registerLiveEditor } from "@repo/editor/live-editor";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe("the live editors, by the item each holds", () => {
  it("answers for an item while its editor is registered, and not once it leaves", () => {
    const editor = createSlateEditor();
    const off = registerLiveEditor("item-a", editor);
    expect(getLiveEditor("item-a")).toBe(editor);
    expect(liveEditorItemId(editor)).toBe("item-a");
    off();
    expect(getLiveEditor("item-a")).toBeNull();
    expect(liveEditorItemId(editor)).toBe("item-a");
  });

  it("keeps the incoming editor when the replaced one's disposer runs", () => {
    const outgoing = createSlateEditor();
    const incoming = createSlateEditor();
    const offOutgoing = registerLiveEditor("item-a", outgoing);
    cleanups.push(registerLiveEditor("item-a", incoming));
    offOutgoing();
    expect(getLiveEditor("item-a")).toBe(incoming);
  });
});
