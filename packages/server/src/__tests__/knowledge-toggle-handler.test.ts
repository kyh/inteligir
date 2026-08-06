// The guarded-toggle HOST path: read → ordinal-locate + raw-equality guard →
// atomic write, and — the contract under test — ANY {ok:false} kicks a
// knowledge refresh (the stale projection self-heals) and never writes.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerKnowledgeHandlers } from "../handlers/knowledge-handlers";

const refresh = vi.fn(() => Promise.resolve());
const files = new Map<string, string>();
const writeText = vi.fn((rel: string, content: string) => {
  files.set(rel, content);
});

/** Capture the group's registrations without booting a host. */
function collectToggleHandler(): (payload: unknown) => unknown {
  const handlers = new Map<string, unknown>();
  registerKnowledgeHandlers((method, fn) => handlers.set(method, fn), {
    knowledge: {
      refresh,
      tasks: () => [],
      backlinks: () => [],
      forwardLinks: () => [],
      graph: () => ({ nodes: [], edges: [] }),
      notesWithTag: () => [],
      search: () => [],
      wikiTargets: () => [],
    },
    vault: {
      readText: (rel: string) => {
        const content = files.get(rel);
        if (content === undefined) throw new Error(`no such file: ${rel}`);
        return content;
      },
      writeText,
    },
  });
  const fn = handlers.get("toggleVaultTask");
  if (typeof fn !== "function") throw new Error("toggleVaultTask not registered");
  return (payload) => fn(payload);
}

const DOC = ["# Plan", "", "- [ ] task one", "- [ ] task two"].join("\n");

beforeEach(() => {
  refresh.mockClear();
  writeText.mockClear();
  files.clear();
  files.set("plan.md", DOC);
});

describe("toggleVaultTask handler", () => {
  it("writes the flipped content when the guard passes (no refresh needed)", () => {
    const toggle = collectToggleHandler();
    const result: unknown = toggle({ path: "plan.md", ordinal: 1, expectedRaw: "- [ ] task two" });
    expect(result).toEqual({ ok: true, checked: true });
    expect(writeText).toHaveBeenCalledWith(
      "plan.md",
      ["# Plan", "", "- [ ] task one", "- [x] task two"].join("\n"),
    );
    // Success invalidates through the write's own save notifiers — no
    // explicit refresh from the handler.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("{ok:false} on raw drift: refuses, kicks refresh, never writes", () => {
    const toggle = collectToggleHandler();
    const result: unknown = toggle({
      path: "plan.md",
      ordinal: 1,
      expectedRaw: "- [ ] task two EDITED",
    });
    expect(result).toEqual({
      ok: false,
      reason: "line-changed",
      error: expect.stringContaining("changed"),
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("{ok:false} on a vanished ordinal: refuses, kicks refresh", () => {
    const toggle = collectToggleHandler();
    const result: unknown = toggle({ path: "plan.md", ordinal: 7, expectedRaw: "- [ ] gone" });
    expect(result).toEqual({
      ok: false,
      reason: "line-missing",
      error: expect.any(String),
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("{ok:false} on an unreadable file: refuses as line-missing, kicks refresh", () => {
    const toggle = collectToggleHandler();
    const result: unknown = toggle({ path: "gone.md", ordinal: 0, expectedRaw: "- [ ] x" });
    expect(result).toEqual({
      ok: false,
      reason: "line-missing",
      error: expect.stringContaining("gone.md"),
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
