import { createSlateEditor } from "platejs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  announceLiveEditorEdit,
  getLiveEditor,
  registerLiveEditor,
  subscribeLiveEditors,
  whenLiveEditor,
} from "@repo/editor/live-editor";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  vi.useRealTimers();
});

const listen = () => {
  const listener = vi.fn<() => void>();
  cleanups.push(subscribeLiveEditors(listener));
  return listener;
};

describe("the live-editor channel", () => {
  it("tells a reader when an editor registers, leaves and edits", () => {
    const listener = listen();
    const off = registerLiveEditor("a.md", createSlateEditor());
    expect(listener).toHaveBeenCalledTimes(1);
    announceLiveEditorEdit();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("stays quiet when a replaced editor's disposer runs, since the path still answers", () => {
    const outgoing = createSlateEditor();
    const incoming = createSlateEditor();
    const offOutgoing = registerLiveEditor("a.md", outgoing);
    cleanups.push(registerLiveEditor("a.md", incoming));
    const listener = listen();
    offOutgoing();
    expect(listener).not.toHaveBeenCalled();
    expect(getLiveEditor("a.md")).toBe(incoming);
  });
});

describe("whenLiveEditor", () => {
  it("answers with the editor that mounts for the path, not another path's", async () => {
    const waiting = whenLiveEditor("a.md", 1000);
    cleanups.push(registerLiveEditor("b.md", createSlateEditor()));
    const editor = createSlateEditor();
    cleanups.push(registerLiveEditor("a.md", editor));
    await expect(waiting).resolves.toBe(editor);
  });

  it("answers null once its bound passes with nothing mounted", async () => {
    vi.useFakeTimers();
    const waiting = whenLiveEditor("a.md", 50);
    vi.advanceTimersByTime(50);
    await expect(waiting).resolves.toBeNull();
  });
});
