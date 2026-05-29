import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { ShellManager } from "@/main/shell";
import { CHAT_WIDGET_ID, isArtifactWidget } from "@/shared/shell";
import type { ArtifactSpec } from "@/shared/artifacts";

const SPEC: ArtifactSpec = {
  root: "r",
  elements: { r: { type: "Text", props: { text: "hi" } } },
};

let storePath: string;
let mgr: ShellManager;

beforeEach(() => {
  storePath = path.join(os.tmpdir(), `shell-test-${Date.now()}-${Math.random()}.json`);
  mgr = new ShellManager(storePath);
});

afterEach(() => {
  fs.rmSync(storePath, { force: true });
});

describe("ShellManager", () => {
  it("seeds a permanent chat widget", () => {
    const { widgets } = mgr.list();
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.id).toBe(CHAT_WIDGET_ID);
    expect(widgets[0]!.type).toBe("chat");
  });

  it("refuses to remove the chat widget", () => {
    expect(mgr.removeWidget(CHAT_WIDGET_ID)).toBe(false);
    expect(mgr.getWidget(CHAT_WIDGET_ID)).not.toBeNull();
  });
});

describe("ShellManager.upsertArtifact", () => {
  it("creates an artifact widget with a slugged id and auto-placed geometry", () => {
    const chat = mgr.list().widgets.find((w) => w.type === "chat")!;
    const created = mgr.upsertArtifact({ title: "My Panel", spec: SPEC });
    expect(created.id).toBe("my-panel");
    expect(created.type).toBe("artifact");
    expect(created.createdAt).toBe(created.updatedAt);
    // Auto-placed below everything already in the workspace (the chat widget).
    expect(created.geometry.y).toBeGreaterThanOrEqual(chat.geometry.y + chat.geometry.h);
  });

  it("never allocates the reserved chat id", () => {
    const created = mgr.upsertArtifact({ title: "chat", spec: SPEC });
    expect(created.id).not.toBe(CHAT_WIDGET_ID);
  });

  it("preserves geometry + createdAt across an update", () => {
    const created = mgr.upsertArtifact({ id: "a", title: "A", spec: SPEC });
    mgr.setGeometries({ a: { x: 2, y: 3, w: 4, h: 5 } });
    const updated = mgr.upsertArtifact({ id: "a", title: "A2", spec: SPEC });
    expect(updated.geometry).toMatchObject({ x: 2, y: 3, w: 4, h: 5 });
    expect(updated.createdAt).toBe(created.createdAt);
  });
});

describe("ShellManager.setArtifactState", () => {
  it("replaces state wholesale so cleared keys disappear, and bumps updatedAt", async () => {
    const created = mgr.upsertArtifact({ title: "S", spec: SPEC, state: { a: 1, b: 2 } });
    await new Promise((r) => setTimeout(r, 2));
    const next = mgr.setArtifactState(created.id, { a: 9 });
    expect(next?.state).toEqual({ a: 9 });
    expect(next?.state).not.toHaveProperty("b");
    expect(next!.updatedAt).toBeGreaterThan(created.updatedAt);
  });

  it("returns null for an unknown id", () => {
    expect(mgr.setArtifactState("nope", { a: 1 })).toBeNull();
  });
});

describe("ShellManager.patchArtifactSpec", () => {
  it("applies an RFC 6902 replace to the spec", () => {
    mgr.upsertArtifact({ id: "p", title: "P", spec: SPEC });
    const patched = mgr.patchArtifactSpec({
      id: "p",
      ops: [{ op: "replace", path: "/elements/r/props/text", value: "bye" }],
    });
    expect(isArtifactWidget(patched)).toBe(true);
    expect(patched.spec.elements["r"]!.props["text"]).toBe("bye");
  });

  it("refuses a prototype-polluting path", () => {
    mgr.upsertArtifact({ id: "p", title: "P", spec: SPEC });
    expect(() =>
      mgr.patchArtifactSpec({
        id: "p",
        ops: [{ op: "add", path: "/__proto__/polluted", value: "x" }],
      }),
    ).toThrow(/prototype-reserved/);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("ShellManager.removeWidget", () => {
  it("removes an artifact widget", () => {
    mgr.upsertArtifact({ id: "gone", title: "Gone", spec: SPEC });
    expect(mgr.removeWidget("gone")).toBe(true);
    expect(mgr.getWidget("gone")).toBeNull();
  });
});
