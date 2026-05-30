import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { ShellManager } from "@/main/shell";
import {
  CHAT_WIDGET_ID,
  type WidgetDef,
  type WidgetInstance,
  type WidgetSpec,
} from "@/shared/shell";

const SPEC: WidgetSpec = {
  root: "r",
  elements: { r: { type: "Text", props: { text: "hi" } } },
};

const FETCH_SPEC: WidgetSpec = {
  root: "r",
  elements: {
    r: {
      type: "Button",
      props: { label: "Fetch" },
      on: { press: { action: "fetchUrl", params: { url: "https://example.com", into: "/body" } } },
    },
  },
};

let storePath: string;
let mgr: ShellManager;

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(label);
  return value;
}

function source(def: WidgetDef) {
  if (def.source.kind !== "json-ui") throw new Error("expected generated widget");
  return def.source;
}

function place(widgetId: string, surface?: "pinned" | "floating"): WidgetInstance {
  return must(mgr.placeWidget(widgetId, surface), `failed to place ${widgetId}`);
}

beforeEach(() => {
  storePath = path.join(os.tmpdir(), `shell-test-${Date.now()}-${Math.random()}.json`);
  mgr = new ShellManager(storePath);
});

afterEach(() => {
  fs.rmSync(storePath, { force: true });
});

describe("ShellManager seeding", () => {
  it("seeds a single permanent pinned chat instance", () => {
    const { defs, instances } = mgr.snapshot();
    expect(defs.some((d) => d.id === CHAT_WIDGET_ID)).toBe(true);
    expect(defs.every((d) => d.source.kind === "builtin-react")).toBe(true);
    expect(instances).toHaveLength(1);
    expect(must(instances[0], "missing chat").widgetId).toBe(CHAT_WIDGET_ID);
    expect(must(instances[0], "missing chat").placement.surface).toBe("pinned");
  });

  it("repairs a hand-edited runtime-ui.json that omits the chat permanent instance", () => {
    const path = storePath.replace(".json", "-handedit.json");
    fs.writeFileSync(
      path,
      JSON.stringify({ version: 2, customDefs: [], instances: [], archivedStates: {} }),
    );
    const repaired = new ShellManager(path);
    const chat = must(
      repaired.snapshot().instances.find((i) => i.widgetId === CHAT_WIDGET_ID),
      "missing repaired chat",
    );
    expect(repaired.getInstance(chat.instanceId)).not.toBeNull();
    fs.rmSync(path, { force: true });
  });

  it("refuses to unplace the chat instance", () => {
    const chat = must(mgr.snapshot().instances[0], "missing chat");
    expect(mgr.unplaceWidget(chat.instanceId)).toBe(false);
    expect(mgr.snapshot().instances).toHaveLength(1);
  });
});

describe("ShellManager.installWidget", () => {
  it("installs without placing", () => {
    const def = mgr.installWidget({ title: "My Panel", spec: SPEC });
    expect(def.id).toBe("my-panel");
    expect(def.revision).toBe(1);
    expect(def.source.kind).toBe("json-ui");
    const snap = mgr.snapshot();
    expect(snap.defs.some((d) => d.id === "my-panel")).toBe(true);
    expect(snap.instances.some((i) => i.widgetId === "my-panel")).toBe(false);
  });

  it("places a generated widget with default state from the spec", () => {
    const def = mgr.installWidget({ title: "S", spec: { ...SPEC, state: { a: 1 } } });
    const instance = place(def.id);
    expect(instance.state).toEqual({ a: 1 });
  });

  it("clones the spec on create so a later caller mutation doesn't change the cached def", () => {
    const liveSpec: WidgetSpec = {
      root: "r",
      elements: { r: { type: "Text", props: { text: "before" } } },
    };
    const def = mgr.installWidget({ title: "Mut", spec: liveSpec });
    // Caller mutates the object it handed over — must not affect the stored def.
    must(liveSpec.elements["r"], "missing live element").props = { text: "after" };
    const stored = must(mgr.getDef(def.id), "missing stored def");
    expect(source(stored).spec.elements["r"]?.props["text"]).toBe("before");
  });

  it("copies spec.state on seed so live mutations don't leak into the def template", () => {
    const def = mgr.installWidget({ title: "S", spec: { ...SPEC, state: { a: 1 } } });
    const instance = place(def.id);
    mgr.setInstanceState(instance.instanceId, { a: 99 });
    const stored = must(mgr.getDef(def.id), "missing stored def");
    expect(source(stored).spec.state).toEqual({ a: 1 });
  });

  it("never collides with a built-in id when auto-slugging", () => {
    const def = mgr.installWidget({ title: "tasks", spec: SPEC });
    expect(def.id).not.toBe("tasks");
  });

  it("rejects a supplied id that matches a built-in", () => {
    expect(() => mgr.installWidget({ id: "settings", title: "Mine", spec: SPEC })).toThrow();
  });

  it("rejects a supplied id that already exists", () => {
    mgr.installWidget({ id: "note", title: "First", spec: SPEC });
    expect(() => mgr.installWidget({ id: "note", title: "Second", spec: SPEC })).toThrow();
  });

  it("accepts trusted live actions", () => {
    const def = mgr.installWidget({ title: "Fetcher", spec: FETCH_SPEC });
    expect(source(def).spec.elements["r"]?.on?.["press"]).toMatchObject({
      action: "fetchUrl",
    });
  });
});

describe("ShellManager.placeWidget", () => {
  it("places a built-in widget once", () => {
    const first = place("tasks");
    const second = place("tasks");
    expect(second.instanceId).toBe(first.instanceId);
    expect(mgr.snapshot().instances.filter((i) => i.widgetId === "tasks")).toHaveLength(1);
  });

  it("switches an already-placed singleton to the requested surface", () => {
    const first = place("tasks", "floating");
    expect(first.placement.surface).toBe("floating");
    const second = place("tasks", "pinned");
    expect(second.instanceId).toBe(first.instanceId);
    expect(second.placement.surface).toBe("pinned");
  });

  it("pops a pinned singleton to floating on a no-surface dock click", () => {
    const pinned = place("tasks", "pinned");
    expect(pinned.placement.surface).toBe("pinned");
    // The dock launches widgets without specifying a surface — for floating
    // singletons this raises z, for pinned it must do *something* (pop to
    // floating) instead of silently no-op'ing while the dock shows active.
    const focused = mgr.placeWidget("tasks");
    expect(focused).not.toBeNull();
    expect(focused!.instanceId).toBe(pinned.instanceId);
    expect(focused!.placement.surface).toBe("floating");
  });

  it("places a generated widget multiple times", () => {
    const def = mgr.installWidget({ title: "Note", spec: SPEC });
    place(def.id);
    place(def.id);
    const instances = mgr.snapshot().instances.filter((i) => i.widgetId === def.id);
    expect(instances).toHaveLength(2);
    expect(must(instances[0], "first").instanceId).not.toBe(
      must(instances[1], "second").instanceId,
    );
  });

  it("returns null for an unknown widget id", () => {
    expect(mgr.placeWidget("nope")).toBeNull();
  });
});

describe("ShellManager.deleteWidget", () => {
  it("deletes a generated def and all instances", () => {
    const def = mgr.installWidget({ title: "Note", spec: SPEC });
    place(def.id);
    expect(mgr.deleteWidget(def.id, def.revision)).toBe(true);
    const snap = mgr.snapshot();
    expect(snap.defs.some((d) => d.id === def.id)).toBe(false);
    expect(snap.instances.some((i) => i.widgetId === def.id)).toBe(false);
  });

  it("checks delete revision when supplied", () => {
    const def = mgr.installWidget({ title: "Note", spec: SPEC });
    expect(() => mgr.deleteWidget(def.id, def.revision + 1)).toThrow(/revision mismatch/);
  });

  it("archives state on unplace and restores it on next placement", () => {
    const placed = place("tasks");
    mgr.setInstanceState(placed.instanceId, { count: 7, note: "hi" });
    expect(mgr.unplaceWidget(placed.instanceId)).toBe(true);
    const replaced = place("tasks");
    expect(replaced.state).toEqual({ count: 7, note: "hi" });
  });

  it("clears the archive when an instance is unplaced with empty state", () => {
    const def = mgr.installWidget({
      title: "Note",
      spec: { ...SPEC, state: { text: "default" } },
      state: { text: "default" },
    });
    const instance = place(def.id);
    mgr.setInstanceState(instance.instanceId, { text: "edited" });
    mgr.unplaceWidget(instance.instanceId);
    // Confirm archive captured the edit, then place + clear-to-empty + unplace.
    const re = place(def.id);
    expect(re.state).toEqual({ text: "edited" });
    mgr.setInstanceState(re.instanceId, {});
    mgr.unplaceWidget(re.instanceId);
    // Next placement must fall back to the spec's default, not the stale
    // 'edited' archive that the empty unplace should have invalidated.
    const fresh = place(def.id);
    expect(fresh.state).toEqual({ text: "default" });
  });

  it("does not seed a sibling instance from the archive when one is still live", () => {
    const def = mgr.installWidget({
      title: "Note",
      spec: { ...SPEC, state: { text: "" } },
      state: { text: "" },
    });
    const instance = place(def.id);
    mgr.setInstanceState(instance.instanceId, { text: "first" });
    mgr.unplaceWidget(instance.instanceId);
    const re = place(def.id);
    expect(re.state).toEqual({ text: "first" }); // restored from archive
    mgr.setInstanceState(re.instanceId, { text: "live" });
    // Adding a second multi-instance placement while `re` is still placed —
    // it must start from the spec default, not the (now stale) archive.
    const sibling = place(def.id);
    expect(sibling.instanceId).not.toBe(re.instanceId);
    expect(sibling.state).toEqual({ text: "" });
  });

  it("rehydrates a fresh object so editing the restored instance doesn't poison the archive", () => {
    const def = mgr.installWidget({
      title: "Note",
      spec: { ...SPEC, state: { text: "first" } },
      state: { text: "first" },
    });
    const instance = place(def.id);
    mgr.unplaceWidget(instance.instanceId);
    const re = place(def.id);
    mgr.setInstanceState(re.instanceId, { text: "edited" });
    mgr.unplaceWidget(re.instanceId);
    // The unplace just above overwrites the archive with 'edited'; if the
    // first restore had aliased the archive object instead of copying it,
    // the intermediate 'edited' write would have mutated the archive in
    // place before the second unplace replaced it — same outcome here, but
    // the next placement should be 'edited' (the most recent unplace), not
    // some stale aliased value.
    const next = place(def.id);
    expect(next.state).toEqual({ text: "edited" });
  });

  it("clears archived state when the generated def is deleted", () => {
    const def = mgr.installWidget({
      title: "Note",
      spec: SPEC,
      state: { body: "draft" },
    });
    const instance = place(def.id);
    mgr.setInstanceState(instance.instanceId, { body: "edited" });
    mgr.unplaceWidget(instance.instanceId);
    mgr.deleteWidget(def.id, def.revision);
    // A new generated widget recreated with the same id starts from its own
    // spec.state, not the prior archived "edited" value.
    const recreated = mgr.installWidget({
      id: def.id,
      title: "Note",
      spec: { ...SPEC, state: { body: "fresh" } },
    });
    const recreatedInstance = place(recreated.id);
    expect(recreatedInstance.state).toEqual({ body: "fresh" });
  });

  it("clears archived state when the generated def is deleted without revision check", () => {
    const def = mgr.installWidget({
      title: "Another Note",
      spec: SPEC,
      state: { body: "draft" },
    });
    const instance = place(def.id);
    mgr.setInstanceState(instance.instanceId, { body: "edited" });
    mgr.unplaceWidget(instance.instanceId);
    mgr.deleteWidget(def.id);
    // A same-id generated widget recreated later starts from its own state.
    const recreated = mgr.installWidget({
      id: def.id,
      title: "Another Note",
      spec: { ...SPEC, state: { body: "fresh" } },
    });
    expect(place(recreated.id).state).toEqual({ body: "fresh" });
  });
});

describe("ShellManager state and patching", () => {
  it("replaces an instance's state wholesale", () => {
    const def = mgr.installWidget({ title: "S", spec: SPEC, state: { a: 1, b: 2 } });
    const instance = place(def.id);
    const next = mgr.setInstanceState(instance.instanceId, { a: 9 });
    expect(next?.state).toEqual({ a: 9 });
    expect(next?.state).not.toHaveProperty("b");
  });

  it("applies a revision-checked RFC 6902 replace", () => {
    const def = mgr.installWidget({ id: "p", title: "P", spec: SPEC });
    const patched = mgr.patchWidgetSpec({
      id: def.id,
      expectedRevision: def.revision,
      ops: [{ op: "replace", path: "/elements/r/props/text", value: "bye" }],
    });
    expect(source(patched).spec.elements["r"]?.props["text"]).toBe("bye");
    expect(patched.revision).toBe(2);
  });

  it("refuses a prototype-polluting path", () => {
    const def = mgr.installWidget({ id: "p", title: "P", spec: SPEC });
    expect(() =>
      mgr.patchWidgetSpec({
        id: def.id,
        expectedRevision: def.revision,
        ops: [{ op: "add", path: "/__proto__/polluted", value: "x" }],
      }),
    ).toThrow(/prototype-reserved/);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("refuses to patch a built-in def", () => {
    expect(() =>
      mgr.patchWidgetSpec({
        id: "tasks",
        expectedRevision: 1,
        ops: [{ op: "replace", path: "/x", value: 1 }],
      }),
    ).toThrow();
  });
});

describe("ShellManager geometry", () => {
  it("updates a pinned instance's geometry by instanceId", () => {
    const placed = place("tasks", "pinned");
    mgr.setGeometries({ [placed.instanceId]: { x: 1, y: 2, w: 3, h: 4 } });
    const updated = must(mgr.getInstance(placed.instanceId), "missing updated");
    if (updated.placement.surface !== "pinned") throw new Error("expected pinned");
    expect(updated.placement.geometry).toMatchObject({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("ignores geometries targeted at a floating instance", () => {
    const placed = place("tasks", "floating");
    mgr.setGeometries({ [placed.instanceId]: { x: 1, y: 2, w: 3, h: 4 } });
    expect(must(mgr.getInstance(placed.instanceId), "missing").placement.surface).toBe("floating");
  });

  it("preserves existing minW/minH when the payload omits them", () => {
    const placed = place("tasks", "pinned");
    if (placed.placement.surface !== "pinned") throw new Error("expected pinned");
    const minW = placed.placement.geometry.minW;
    const minH = placed.placement.geometry.minH;
    mgr.setGeometries({ [placed.instanceId]: { x: 2, y: 3, w: 5, h: 4 } });
    const updated = must(mgr.getInstance(placed.instanceId), "missing");
    if (updated.placement.surface !== "pinned") throw new Error("expected pinned");
    expect(updated.placement.geometry.minW).toBe(minW);
    expect(updated.placement.geometry.minH).toBe(minH);
  });
});

describe("ShellManager surfaces", () => {
  it("places as a floating window by default", () => {
    expect(place("tasks").placement.surface).toBe("floating");
  });

  it("places on the grid when asked", () => {
    expect(place("settings", "pinned").placement.surface).toBe("pinned");
  });

  it("setSurface drops to the target surface's defaults", () => {
    const placed = place("tasks", "pinned");
    const floated = must(mgr.setSurface(placed.instanceId, "floating"), "float failed");
    expect(floated.placement.surface).toBe("floating");
    const docked = must(mgr.setSurface(placed.instanceId, "pinned"), "dock failed");
    expect(docked.placement.surface).toBe("pinned");
  });
});
