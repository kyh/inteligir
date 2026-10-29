import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { deferred } from "@repo/editor/deferred";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

afterEach(() => {
  vi.useRealTimers();
});

describe("flushing the open note", () => {
  it("answers true with no host installed — there is no buffer to lose", async () => {
    expect(await flushOpenNote()).toBe(true);
  });

  it("awaits the installed host's flush and answers its verdict", async () => {
    const flush = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const { uninstall } = installFakeEditorHost({ flush });
    onTestFinished(uninstall);

    expect(await flushOpenNote()).toBe(false);
    expect(flush).toHaveBeenCalledTimes(1);
    flush.mockResolvedValue(true);
    expect(await flushOpenNote()).toBe(true);
  });

  it("answers false for a flush that rejects, never rejecting itself", async () => {
    const { uninstall } = installFakeEditorHost({
      flush: async () => await Promise.reject(new Error("write refused")),
    });
    onTestFinished(uninstall);

    expect(await flushOpenNote()).toBe(false);
  });

  it("answers false once a flush outlasts its timeout", async () => {
    vi.useFakeTimers();
    const held = deferred<boolean>();
    const { uninstall } = installFakeEditorHost({ flush: async () => await held.promise });
    onTestFinished(uninstall);

    const verdict = flushOpenNote();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await verdict).toBe(false);
  });

  it("stops flushing a host once its disposer runs", async () => {
    const flush = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    installFakeEditorHost({ flush }).uninstall();

    expect(await flushOpenNote()).toBe(true);
    expect(flush).not.toHaveBeenCalled();
  });

  it("keeps a newer host's flush when an older host's disposer runs late", async () => {
    const older = installFakeEditorHost();
    const flush = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const newer = installFakeEditorHost({ flush });
    onTestFinished(newer.uninstall);

    older.uninstall();
    expect(await flushOpenNote()).toBe(false);
    expect(older.calls).toEqual([]);
  });
});
