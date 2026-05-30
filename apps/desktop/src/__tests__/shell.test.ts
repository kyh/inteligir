import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { ShellManager } from "@/main/shell";
import { CHAT_WIDGET_ID, type WidgetSpec } from "@/shared/shell";

const SPEC: WidgetSpec = {
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

describe("ShellManager seeding", () => {
  it("seeds a single permanent, pinned chat instance", () => {
    const { instances, customWidgets } = mgr.snapshot();
    expect(customWidgets).toHaveLength(0);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.widgetId).toBe(CHAT_WIDGET_ID);
    expect(instances[0]!.placement.surface).toBe("pinned");
  });

  it("refuses to unplace the chat instance", () => {
    const chat = mgr.snapshot().instances[0]!;
    expect(mgr.unplaceWidget(chat.instanceId)).toBe(false);
    expect(mgr.snapshot().instances).toHaveLength(1);
  });
});

describe("ShellManager.generateWidget", () => {
  it("creates a custom definition and places one pinned instance", () => {
    const { def, instance } = mgr.generateWidget({ title: "My Panel", spec: SPEC });
    expect(def.id).toBe("my-panel");
    expect(instance.widgetId).toBe("my-panel");
    expect(instance.placement.surface).toBe("pinned");
    const snap = mgr.snapshot();
    expect(snap.customWidgets.map((d) => d.id)).toContain("my-panel");
    expect(snap.instances.filter((i) => i.widgetId === "my-panel")).toHaveLength(1);
  });

  it("seeds instance state from the spec's initial state", () => {
    const { instance } = mgr.generateWidget({
      title: "S",
      spec: { ...SPEC, state: { a: 1 } },
    });
    expect(instance.state).toEqual({ a: 1 });
  });

  it("never collides with a built-in id", () => {
    const { def } = mgr.generateWidget({ title: "tasks", spec: SPEC });
    expect(def.id).not.toBe("tasks");
  });
});

describe("ShellManager.placeWidget", () => {
  it("places a built-in widget once (singleton)", () => {
    const first = mgr.placeWidget("tasks");
    const second = mgr.placeWidget("tasks");
    expect(first).not.toBeNull();
    expect(second!.instanceId).toBe(first!.instanceId);
    expect(mgr.snapshot().instances.filter((i) => i.widgetId === "tasks")).toHaveLength(1);
  });

  it("places a custom widget multiple times (multi-instance)", () => {
    const { def } = mgr.generateWidget({ title: "Note", spec: SPEC });
    mgr.placeWidget(def.id);
    const instances = mgr.snapshot().instances.filter((i) => i.widgetId === def.id);
    expect(instances).toHaveLength(2);
    expect(instances[0]!.instanceId).not.toBe(instances[1]!.instanceId);
  });

  it("returns null for an unknown widget id", () => {
    expect(mgr.placeWidget("nope")).toBeNull();
  });
});

describe("ShellManager.unplaceWidget / deleteWidget", () => {
  it("unplaces a built-in instance without deleting anything else", () => {
    const placed = mgr.placeWidget("tasks")!;
    expect(mgr.unplaceWidget(placed.instanceId)).toBe(true);
    expect(mgr.snapshot().instances.some((i) => i.widgetId === "tasks")).toBe(false);
  });

  it("deletes a custom definition and all its instances", () => {
    const { def } = mgr.generateWidget({ title: "Note", spec: SPEC });
    mgr.placeWidget(def.id);
    expect(mgr.deleteWidget(def.id)).toBe(true);
    const snap = mgr.snapshot();
    expect(snap.customWidgets.some((d) => d.id === def.id)).toBe(false);
    expect(snap.instances.some((i) => i.widgetId === def.id)).toBe(false);
  });
});

describe("ShellManager.setInstanceState", () => {
  it("replaces an instance's state wholesale", () => {
    const { instance } = mgr.generateWidget({ title: "S", spec: SPEC, state: { a: 1, b: 2 } });
    const next = mgr.setInstanceState(instance.instanceId, { a: 9 });
    expect(next?.state).toEqual({ a: 9 });
    expect(next?.state).not.toHaveProperty("b");
  });
});

describe("ShellManager.patchWidgetSpec", () => {
  it("applies an RFC 6902 replace to a custom widget's spec", () => {
    const { def } = mgr.generateWidget({ id: "p", title: "P", spec: SPEC });
    const patched = mgr.patchWidgetSpec({
      id: def.id,
      ops: [{ op: "replace", path: "/elements/r/props/text", value: "bye" }],
    });
    expect(patched.spec.elements["r"]!.props["text"]).toBe("bye");
  });

  it("refuses a prototype-polluting path", () => {
    mgr.generateWidget({ id: "p", title: "P", spec: SPEC });
    expect(() =>
      mgr.patchWidgetSpec({ id: "p", ops: [{ op: "add", path: "/__proto__/polluted", value: "x" }] }),
    ).toThrow(/prototype-reserved/);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("ShellManager.setGeometries", () => {
  it("updates a pinned instance's geometry by instanceId", () => {
    const placed = mgr.placeWidget("tasks", "pinned")!;
    mgr.setGeometries({ [placed.instanceId]: { x: 1, y: 2, w: 3, h: 4 } });
    const updated = mgr.getInstance(placed.instanceId);
    expect(updated!.placement.surface).toBe("pinned");
    if (updated!.placement.surface === "pinned") {
      expect(updated!.placement.geometry).toMatchObject({ x: 1, y: 2, w: 3, h: 4 });
    }
  });

  it("ignores geometries targeted at a floating instance", () => {
    const placed = mgr.placeWidget("tasks", "floating")!;
    mgr.setGeometries({ [placed.instanceId]: { x: 1, y: 2, w: 3, h: 4 } });
    expect(mgr.getInstance(placed.instanceId)!.placement.surface).toBe("floating");
  });
});

describe("ShellManager surfaces", () => {
  it("places as a floating window by default", () => {
    const placed = mgr.placeWidget("tasks")!;
    expect(placed.placement.surface).toBe("floating");
  });

  it("places on the grid when asked", () => {
    const placed = mgr.placeWidget("settings", "pinned")!;
    expect(placed.placement.surface).toBe("pinned");
  });

  it("setSurface drops to the target surface's defaults", () => {
    const placed = mgr.placeWidget("tasks", "pinned")!;
    const floated = mgr.setSurface(placed.instanceId, "floating");
    expect(floated!.placement.surface).toBe("floating");
    if (floated!.placement.surface === "floating") {
      expect(floated!.placement.rect).toBeDefined();
      expect(floated!.placement.z).toBeGreaterThan(0);
    }
    const docked = mgr.setSurface(placed.instanceId, "pinned");
    expect(docked!.placement.surface).toBe("pinned");
  });
});
