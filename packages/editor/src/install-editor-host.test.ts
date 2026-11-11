import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { getEditorHostActions } from "@repo/editor/host-io";
import type { EditorHost, EditorHostActions } from "@repo/editor/host-io";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn<() => void>(), {
    error: vi.fn<() => void>(),
    success: vi.fn<() => void>(),
    warning: vi.fn<() => void>(),
  }),
}));

describe("installing the editor's host", () => {
  it("takes no host that leaves a capability out", () => {
    expectTypeOf<Omit<EditorHost, "actions">>().not.toExtend<EditorHost>();
    expectTypeOf<Omit<EditorHostActions, "agent">>().not.toExtend<EditorHostActions>();
    expectTypeOf<Omit<EditorHostActions, "items">>().not.toExtend<EditorHostActions>();
  });

  it("hands a deep node the actions it was installed with", () => {
    const showTag = vi.fn<(tag: string) => void>();
    installFakeEditorHost({ agent: { askAboutSelection: vi.fn<() => void>(), showTag } });

    getEditorHostActions().agent.showTag("errands");
    expect(showTag).toHaveBeenCalledExactlyOnceWith("errands");
  });
});
