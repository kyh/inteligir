import { createSlateEditor } from "platejs";
import { afterEach, describe, expect, it } from "vitest";

import { getLiveEditor, isLiveEditor, registerLiveEditor } from "@repo/editor/live-editor";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe("the live editors, by the path each serves", () => {
  it("answers for a path while its editor is registered, and not once it leaves", () => {
    const editor = createSlateEditor();
    const off = registerLiveEditor("a.md", editor);
    expect(getLiveEditor("a.md")).toBe(editor);
    expect(isLiveEditor(editor)).toBe(true);
    off();
    expect(getLiveEditor("a.md")).toBeNull();
    expect(isLiveEditor(editor)).toBe(false);
  });

  it("keeps the incoming editor when the replaced one's disposer runs", () => {
    const outgoing = createSlateEditor();
    const incoming = createSlateEditor();
    const offOutgoing = registerLiveEditor("a.md", outgoing);
    cleanups.push(registerLiveEditor("a.md", incoming));
    offOutgoing();
    expect(getLiveEditor("a.md")).toBe(incoming);
    expect(isLiveEditor(outgoing)).toBe(false);
  });
});
