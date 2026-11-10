// A store atom every block holds is recomputed on every change, so a keystroke in a long item
// pays for each block. Plate's navigation flash and its flat-model toggle hider each hold one,
// read no block's content, and so leave no stack in the typing budget's watched block: the
// budget's ratio alone would only catch them by timing. Here they are held off by name.

import { TogglePlugin } from "@platejs/toggle/react";
import { createPlateEditor, NavigationFeedbackPlugin } from "platejs/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { indexNoToggles, wrapNoBlock } from "@repo/editor/kits/toggle-kit";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { mountNote } from "./test-support/memory-note";

describe("the per-block store work a keystroke would pay", () => {
  beforeAll(() => {
    /* oxlint-disable class-methods-use-this -- the observer's instance API: `new ResizeObserver()` reaches these on the instance, never as statics */
    class ResizeObserverStub {
      observe = (): void => {};
      unobserve = (): void => {};
      disconnect = (): void => {};
    }
    /* oxlint-enable class-methods-use-this */
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    installFakeEditorHost();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("is off in the editor the app mounts: no navigation flash, no flat-model toggle hider", async () => {
    const { editor } = await mountNote("note", "# Note\n\nBody.\n");
    // a plugin switched off is never registered
    expect(Object.keys(editor.plugins)).not.toContain(NavigationFeedbackPlugin.key);
    expect(Object.keys(createPlateEditor().plugins)).toContain(NavigationFeedbackPlugin.key);
    const toggle = editor.getPlugin(TogglePlugin);
    expect(toggle.render.aboveNodes).toBe(wrapNoBlock);
    expect(toggle.useHooks).toBe(indexNoToggles);
  });
});
