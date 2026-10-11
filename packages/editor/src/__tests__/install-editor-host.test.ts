import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { getEditorHostActions } from "@repo/editor/host-io";
import type { EditorHost, EditorHostActions } from "@repo/editor/host-io";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

describe("installing the editor's host", () => {
  it("takes no host that leaves a capability out", () => {
    expectTypeOf<Omit<EditorHost, "actions">>().not.toExtend<EditorHost>();
    expectTypeOf<Omit<EditorHost, "store">>().not.toExtend<EditorHost>();
    expectTypeOf<Omit<EditorHostActions, "agent">>().not.toExtend<EditorHostActions>();
    expectTypeOf<Omit<EditorHostActions, "comments">>().not.toExtend<EditorHostActions>();
  });

  it("hands a deep node the actions it was installed with", () => {
    const showTag = vi.fn<(tag: string) => void>();
    const { uninstall } = installFakeEditorHost({ agent: { askAboutSelection: vi.fn(), showTag } });

    getEditorHostActions().agent.showTag("errands");
    expect(showTag).toHaveBeenCalledExactlyOnceWith("errands");
    uninstall();
  });

  it("flushes its store through the host's own flush, until its disposer runs", async () => {
    const { calls, uninstall } = installFakeEditorHost();

    expect(await flushOpenNote()).toBe(true);
    expect(calls).toEqual([{ action: "flush", args: [] }]);

    uninstall();
    expect(await flushOpenNote()).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
