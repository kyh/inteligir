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
  type WidgetSurface,
} from "@/shared/shell";
import type { WidgetSpec } from "@/shared/widget-spec";

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

const REPEAT_AND_STATE_ACTIONS_SPEC: WidgetSpec = {
  root: "list",
  elements: {
    list: {
      type: "Stack",
      props: { gap: "sm" },
      repeat: { statePath: "/items", key: "id" },
      children: ["row"],
    },
    row: {
      type: "Row",
      props: {},
      children: ["label"],
      on: {
        press: [
          { action: "pushState", params: { statePath: "/items", value: { id: "next" } } },
          { action: "notify", params: { message: "Added" } },
        ],
      },
      watch: {
        "/items": { action: "validateForm", params: { statePath: "/validation" } },
      },
    },
    label: { type: "Text", props: { text: "Item" } },
  },
  state: { items: [] },
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

function place(widgetId: string, surface?: WidgetSurface): WidgetInstance {
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
  it("seeds the dashboard widgets on first run, no chat", () => {
    const { defs, instances } = mgr.snapshot();
    // The chat widget def still exists (it's a launchable built-in) but is
    // NOT pre-placed on the grid. The dashboard pins four json-ui cards plus
    // the Agenda and To-Do built-ins (which replaced the old static Meeting
    // Prep / Up Next / To Do cards).
    expect(defs.some((d) => d.id === CHAT_WIDGET_ID)).toBe(true);
    const jsonUiIds = defs
      .filter((d) => d.source.kind === "json-ui")
      .map((d) => d.id)
      .toSorted();
    expect(jsonUiIds).toEqual(["date", "people", "today", "weather"]);
    // The two built-in dashboard widgets are seeded as instances, not defs
    // (their defs live in BUILTIN_DEFS).
    const placedIds = instances.map((i) => i.widgetId).toSorted();
    expect(placedIds).toEqual(["agenda", "date", "people", "today", "todos", "weather"]);
    expect(instances.every((i) => i.placement.surface === "pinned")).toBe(true);
    expect(instances.some((i) => i.widgetId === CHAT_WIDGET_ID)).toBe(false);
  });

  it("lets chat be launched on demand from the dock", () => {
    const totalBefore = mgr.snapshot().instances.length;
    expect(mgr.placeWidget(CHAT_WIDGET_ID, "pinned")).not.toBeNull();
    expect(mgr.snapshot().instances).toHaveLength(totalBefore + 1);
    const chatInstance = must(
      mgr.snapshot().instances.find((i) => i.widgetId === CHAT_WIDGET_ID),
      "missing chat",
    );
    expect(mgr.unplaceWidget(chatInstance.instanceId)).toBe(true);
    expect(mgr.snapshot().instances).toHaveLength(totalBefore);
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
    expect(source(stored).spec.elements["r"]?.props?.["text"]).toBe("before");
  });

  it("copies spec.state on seed so live mutations don't leak into the def template", async () => {
    const def = mgr.installWidget({ title: "S", spec: { ...SPEC, state: { a: 1 } } });
    const instance = place(def.id);
    await mgr.setInstanceState(instance.instanceId, { a: 99 });
    const stored = must(mgr.getDef(def.id), "missing stored def");
    expect(source(stored).spec.state).toEqual({ a: 1 });
  });

  it("deep-clones nested seed state so collection mutations don't alias the def", () => {
    const def = mgr.installWidget({
      title: "List",
      spec: { ...SPEC, state: { items: ["a", "b"] } },
    });
    const instance = place(def.id);
    // Simulate a live in-place mutation of the instance's nested array — a
    // shallow copy would have aliased it with the persisted spec.state.items
    // (and the archive entry on the next unplace cycle).
    const items = instance.state["items"];
    if (!Array.isArray(items)) throw new Error("expected items array");
    items.push("c");
    const stored = must(mgr.getDef(def.id), "missing stored def");
    expect(source(stored).spec.state).toEqual({ items: ["a", "b"] });
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

  it("accepts json-render repeat and built-in state actions", () => {
    const def = mgr.installWidget({ title: "List", spec: REPEAT_AND_STATE_ACTIONS_SPEC });
    const stored = source(def).spec;
    expect(stored.elements["list"]?.repeat).toEqual({ statePath: "/items", key: "id" });
    const press = stored.elements["row"]?.on?.["press"];
    if (!Array.isArray(press)) throw new Error("expected action array");
    expect(press.map((action) => action.action)).toEqual(["pushState", "notify"]);
    expect(stored.elements["row"]?.watch?.["/items"]).toMatchObject({
      action: "validateForm",
    });
  });

  it("rejects bad component props at the write boundary with an element-precise error", () => {
    // The agent's manage_ui catch block forwards this message as the tool
    // result — it must name the element, component, and prop.
    expect(() =>
      mgr.installWidget({
        title: "Broken",
        spec: { root: "r", elements: { r: { type: "Card", props: { children: "hi" } } } },
      }),
    ).toThrow(/element 'r' \(Card\) props\.children/);
    expect(mgr.snapshot().defs.some((d) => d.title === "Broken")).toBe(false);
  });

  it("tolerates a legacy on-disk def with since-invalidated props (no store wipe)", () => {
    const legacyPath = storePath.replace(".json", "-legacy.json");
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        version: 3,
        customDefs: [
          {
            id: "legacy",
            title: "Legacy",
            revision: 1,
            singleton: false,
            defaultGeometry: { x: 0, y: 0, w: 4, h: 4 },
            source: {
              kind: "json-ui",
              // Bad props that the write boundary now rejects — written by an
              // older build. Decode must keep the def (renderer flags it).
              spec: { root: "r", elements: { r: { type: "Card", props: { className: "x" } } } },
              createdAt: 0,
              updatedAt: 0,
            },
          },
        ],
        instances: [],
        archivedStates: {},
      }),
    );
    try {
      const legacyMgr = new ShellManager(legacyPath);
      const def = must(legacyMgr.getDef("legacy"), "legacy def must survive decode");
      expect(source(def).spec.elements["r"]?.props).toEqual({ className: "x" });
      // But re-writing the same bad spec through the boundary still fails.
      expect(() =>
        legacyMgr.updateWidget({
          id: "legacy",
          expectedRevision: 1,
          spec: { root: "r", elements: { r: { type: "Card", props: { className: "x" } } } },
        }),
      ).toThrow(/Unexpected property/);
    } finally {
      fs.rmSync(legacyPath, { force: true });
    }
  });
});

function backupsFor(filePath: string, marker: string): string[] {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.${marker}`))
    .map((f) => path.join(dir, f));
}

describe("ShellManager store versioning", () => {
  it("quarantines a runtime-ui.json written by a newer build instead of wiping it", () => {
    const newerPath = storePath.replace(".json", "-newer.json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const original = { version: 4, futureShape: true };
    fs.writeFileSync(newerPath, JSON.stringify(original));
    try {
      const newer = new ShellManager(newerPath);
      // Read succeeds with defaults — no throw, no silent loss.
      expect(newer.snapshot().instances.length).toBeGreaterThan(0);
      // Original moved aside under a name recording the file's version.
      expect(fs.existsSync(newerPath)).toBe(false);
      const backups = backupsFor(newerPath, "newer-v4-");
      expect(backups).toHaveLength(1);
      const backup = must(backups[0], "missing backup");
      expect(JSON.parse(fs.readFileSync(backup, "utf8"))).toEqual(original);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("newer than supported"));
    } finally {
      errSpy.mockRestore();
      for (const f of backupsFor(newerPath, "")) fs.rmSync(f, { force: true });
      fs.rmSync(newerPath, { force: true });
    }
  });

  it("treats an unversioned runtime-ui.json as corruption: backed up, logged, reset", () => {
    const legacyPath = storePath.replace(".json", "-unversioned.json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ customDefs: [], instances: [], archivedStates: {} }),
    );
    try {
      const legacy = new ShellManager(legacyPath);
      expect(legacy.snapshot().instances.length).toBeGreaterThan(0);
      expect(fs.existsSync(legacyPath)).toBe(false);
      expect(backupsFor(legacyPath, "corrupt-")).toHaveLength(1);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("legacy migration failed"));
    } finally {
      errSpy.mockRestore();
      for (const f of backupsFor(legacyPath, "")) fs.rmSync(f, { force: true });
      fs.rmSync(legacyPath, { force: true });
    }
  });
});

function v2Def(id: string, spec: unknown) {
  return {
    id,
    title: id,
    revision: 1,
    singleton: false,
    defaultGeometry: { x: 0, y: 0, w: 4, h: 4 },
    source: { kind: "json-ui", spec, createdAt: 0, updatedAt: 0 },
  };
}

function v2File(customDefs: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 2,
    customDefs,
    instances: [],
    archivedStates: {},
    ...extra,
  });
}

function specOf(manager: ShellManager, id: string) {
  return source(must(manager.getDef(id), `missing def ${id}`)).spec;
}

function callToolAddress(action: unknown): unknown {
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    throw new Error("expected action object");
  }
  const params = Reflect.get(action, "params");
  return typeof params === "object" && params !== null ? Reflect.get(params, "tool") : undefined;
}

describe("ShellManager v2→v3 migration (executor 1.4 → 1.5 tool readdressing)", () => {
  it("rewrites v1 callTool addresses in onMount, on, and watch to connection-scoped paths", () => {
    const v2Path = storePath.replace(".json", "-v2.json");
    fs.writeFileSync(
      v2Path,
      v2File([
        v2Def("up-next", {
          root: "r",
          elements: {
            r: {
              type: "Button",
              props: { label: "Reload" },
              on: {
                press: [
                  {
                    action: "callTool",
                    params: { tool: "google_contacts.people.connections.list", into: "/c" },
                  },
                  { action: "notify", params: { message: "done" } },
                ],
              },
              watch: {
                "/c": { action: "callTool", params: { tool: "github.search_issues", into: "/i" } },
              },
            },
          },
          onMount: [
            {
              action: "callTool",
              skipIf: "/events",
              params: { tool: "google_calendar.events.list", into: "/events" },
            },
          ],
        }),
      ]),
    );
    try {
      const migrated = new ShellManager(v2Path);
      const spec = specOf(migrated, "up-next");
      // Google addresses regain the Discovery api-name prefix v1 dropped.
      expect(callToolAddress(spec.onMount?.[0])).toBe(
        "google_calendar.user.default.calendar.events.list",
      );
      expect(spec.onMount?.[0]?.skipIf).toBe("/events");
      const press = spec.elements["r"]?.on?.["press"];
      if (!Array.isArray(press)) throw new Error("expected action array");
      expect(callToolAddress(press[0])).toBe(
        "google_contacts.user.default.people.people.connections.list",
      );
      expect(press[1]).toMatchObject({ action: "notify" });
      // Non-Google integrations get the default connection segments inserted.
      expect(callToolAddress(spec.elements["r"]?.watch?.["/c"])).toBe(
        "github.user.default.search_issues",
      );
      // The migrated shape is persisted eagerly at version 3.
      const onDisk = fs.readFileSync(v2Path, "utf8");
      expect(onDisk).toContain('"version": 3');
      expect(onDisk).toContain("google_calendar.user.default.calendar.events.list");
      expect(onDisk).not.toContain('"google_calendar.events.list"');
    } finally {
      fs.rmSync(v2Path, { force: true });
    }
  });

  it("leaves addresses it cannot confidently rewrite untouched", () => {
    const v2Path = storePath.replace(".json", "-v2-untouched.json");
    fs.writeFileSync(
      v2Path,
      v2File([
        v2Def("mixed", {
          root: "r",
          elements: { r: { type: "Text", props: { text: "hi" } } },
          onMount: [
            // Already connection-scoped (a fresh seed installed on 1.5).
            {
              action: "callTool",
              params: { tool: "google_calendar.user.default.calendar.events.list", into: "/e" },
            },
            // Executor core tools are not connection-scoped in 1.5.
            { action: "callTool", params: { tool: "describe.tool", into: "/d" } },
            // Second segment collides with an owner name — ambiguous.
            { action: "callTool", params: { tool: "slack.user.list", into: "/u" } },
            // Dynamic tool value — state is data, not an address.
            { action: "callTool", params: { tool: { $state: "/toolPath" }, into: "/x" } },
            // `tool` on a non-callTool action is not an address.
            { action: "notify", params: { tool: "google_calendar.events.list" } },
          ],
        }),
      ]),
    );
    try {
      const migrated = new ShellManager(v2Path);
      const onMount = specOf(migrated, "mixed").onMount;
      expect(callToolAddress(onMount?.[0])).toBe(
        "google_calendar.user.default.calendar.events.list",
      );
      expect(callToolAddress(onMount?.[1])).toBe("describe.tool");
      expect(callToolAddress(onMount?.[2])).toBe("slack.user.list");
      expect(callToolAddress(onMount?.[3])).toEqual({ $state: "/toolPath" });
      expect(onMount?.[4]).toEqual({
        action: "notify",
        params: { tool: "google_calendar.events.list" },
      });
    } finally {
      fs.rmSync(v2Path, { force: true });
    }
  });

  it("passes instance state and archivedStates through unchanged (data, not addresses)", () => {
    const v2Path = storePath.replace(".json", "-v2-state.json");
    fs.writeFileSync(
      v2Path,
      v2File([], {
        instances: [
          {
            instanceId: "i1",
            widgetId: "up-next",
            placement: { surface: "pinned", geometry: { x: 0, y: 0, w: 4, h: 4 } },
            // An address-looking string in live state must NOT be rewritten —
            // there is no way to tell it apart from user data.
            state: { lastTool: "google_calendar.events.list" },
          },
        ],
        archivedStates: { people: { note: "google_contacts.people.connections.list" } },
      }),
    );
    try {
      const migrated = new ShellManager(v2Path);
      expect(migrated.getInstance("i1")?.state).toEqual({
        lastTool: "google_calendar.events.list",
      });
      const onDisk = fs.readFileSync(v2Path, "utf8");
      expect(onDisk).toContain('"version": 3');
      expect(onDisk).toContain('"note": "google_contacts.people.connections.list"');
    } finally {
      fs.rmSync(v2Path, { force: true });
    }
  });

  it("is a one-shot upgrade: reopening the migrated file changes nothing", () => {
    const v2Path = storePath.replace(".json", "-v2-reopen.json");
    fs.writeFileSync(
      v2Path,
      v2File([
        v2Def("up-next", {
          root: "r",
          elements: { r: { type: "Text", props: { text: "hi" } } },
          onMount: [
            { action: "callTool", params: { tool: "google_calendar.events.list", into: "/e" } },
          ],
        }),
      ]),
    );
    try {
      const first = new ShellManager(v2Path);
      first.snapshot();
      const afterFirst = fs.readFileSync(v2Path, "utf8");
      const reopened = new ShellManager(v2Path);
      // Same addresses (no double user.default insertion), same bytes — a v3
      // file skips the migration chain entirely.
      expect(callToolAddress(specOf(reopened, "up-next").onMount?.[0])).toBe(
        "google_calendar.user.default.calendar.events.list",
      );
      expect(fs.readFileSync(v2Path, "utf8")).toBe(afterFirst);
      expect(backupsFor(v2Path, "corrupt-")).toHaveLength(0);
    } finally {
      for (const f of backupsFor(v2Path, "")) fs.rmSync(f, { force: true });
      fs.rmSync(v2Path, { force: true });
    }
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

  it("leaves a singleton alone when the requested surface already matches", () => {
    const pinned = place("tasks", "pinned");
    if (pinned.placement.surface !== "pinned") throw new Error("expected pinned");
    const geometry = pinned.placement.geometry;
    // Re-placing with the same surface must not pop to floating — that was
    // the dock-click fallback, which only applies when no surface is given.
    const again = place("tasks", "pinned");
    expect(again.instanceId).toBe(pinned.instanceId);
    expect(again.placement.surface).toBe("pinned");
    if (again.placement.surface !== "pinned") throw new Error("expected pinned");
    expect(again.placement.geometry).toEqual(geometry);
  });

  it("pops a pinned singleton to floating on a no-surface dock click", () => {
    const pinned = place("tasks", "pinned");
    expect(pinned.placement.surface).toBe("pinned");
    // The dock launches widgets without specifying a surface — for floating
    // singletons this raises z, for pinned it must do *something* (pop to
    // floating) instead of silently no-op'ing while the dock shows active.
    const focused = must(mgr.placeWidget("tasks"), "expected focused instance");
    expect(focused.instanceId).toBe(pinned.instanceId);
    expect(focused.placement.surface).toBe("floating");
  });

  it("raises a tied-top floating singleton above its peers on focus", () => {
    const tiedPath = storePath.replace(".json", "-tied-focus.json");
    const sharedZ = 7;
    fs.writeFileSync(
      tiedPath,
      JSON.stringify({
        version: 3,
        customDefs: [],
        instances: [
          {
            instanceId: "tasks",
            widgetId: "tasks",
            placement: {
              surface: "floating",
              rect: { x: 10, y: 10, width: 320, height: 360 },
              z: sharedZ,
            },
            state: {},
          },
          {
            instanceId: "widgets",
            widgetId: "widgets",
            placement: {
              surface: "floating",
              rect: { x: 20, y: 20, width: 320, height: 360 },
              z: sharedZ,
            },
            state: {},
          },
        ],
        archivedStates: {},
      }),
    );
    try {
      const tied = new ShellManager(tiedPath);

      const focusedA = must(tied.placeWidget("tasks"), "expected focused a");
      const focusedB = must(tied.placeWidget("widgets"), "expected focused b");
      if (focusedA.placement.surface !== "floating" || focusedB.placement.surface !== "floating") {
        throw new Error("expected floating");
      }
      // After focusing A then B, B must end up strictly above A.
      expect(focusedB.placement.z).toBeGreaterThan(focusedA.placement.z);
      expect(focusedA.placement.z).toBeGreaterThanOrEqual(sharedZ);
    } finally {
      fs.rmSync(tiedPath, { force: true });
    }
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

  it("archives state on unplace and restores it on next placement", async () => {
    const placed = place("tasks");
    await mgr.setInstanceState(placed.instanceId, { count: 7, note: "hi" });
    expect(mgr.unplaceWidget(placed.instanceId)).toBe(true);
    const replaced = place("tasks");
    expect(replaced.state).toEqual({ count: 7, note: "hi" });
  });

  it("clears the archive when an instance is unplaced with empty state", async () => {
    const def = mgr.installWidget({
      title: "Note",
      spec: { ...SPEC, state: { text: "default" } },
    });
    const instance = place(def.id);
    await mgr.setInstanceState(instance.instanceId, { text: "edited" });
    mgr.unplaceWidget(instance.instanceId);
    // Confirm archive captured the edit, then place + clear-to-empty + unplace.
    const re = place(def.id);
    expect(re.state).toEqual({ text: "edited" });
    await mgr.setInstanceState(re.instanceId, {});
    mgr.unplaceWidget(re.instanceId);
    // Next placement must fall back to the spec's default, not the stale
    // 'edited' archive that the empty unplace should have invalidated.
    const fresh = place(def.id);
    expect(fresh.state).toEqual({ text: "default" });
  });

  it("does not seed a sibling instance from the archive when one is still live", async () => {
    const def = mgr.installWidget({
      title: "Note",
      spec: { ...SPEC, state: { text: "" } },
    });
    const instance = place(def.id);
    await mgr.setInstanceState(instance.instanceId, { text: "first" });
    mgr.unplaceWidget(instance.instanceId);
    const re = place(def.id);
    expect(re.state).toEqual({ text: "first" }); // restored from archive
    await mgr.setInstanceState(re.instanceId, { text: "live" });
    // Adding a second multi-instance placement while `re` is still placed —
    // it must start from the spec default, not the (now stale) archive.
    const sibling = place(def.id);
    expect(sibling.instanceId).not.toBe(re.instanceId);
    expect(sibling.state).toEqual({ text: "" });
  });

  it("rehydrates a fresh object so editing the restored instance doesn't poison the archive", async () => {
    const def = mgr.installWidget({
      title: "Note",
      spec: { ...SPEC, state: { text: "first" } },
    });
    const instance = place(def.id);
    mgr.unplaceWidget(instance.instanceId);
    const re = place(def.id);
    await mgr.setInstanceState(re.instanceId, { text: "edited" });
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

  it("clears archived state when the generated def is deleted", async () => {
    const def = mgr.installWidget({
      title: "Note",
      spec: { ...SPEC, state: { body: "draft" } },
    });
    const instance = place(def.id);
    await mgr.setInstanceState(instance.instanceId, { body: "edited" });
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

  it("clears archived state when the generated def is deleted without revision check", async () => {
    const def = mgr.installWidget({
      title: "Another Note",
      spec: { ...SPEC, state: { body: "draft" } },
    });
    const instance = place(def.id);
    await mgr.setInstanceState(instance.instanceId, { body: "edited" });
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
  it("replaces an instance's state wholesale", async () => {
    const def = mgr.installWidget({ title: "S", spec: { ...SPEC, state: { a: 1, b: 2 } } });
    const instance = place(def.id);
    const next = await mgr.setInstanceState(instance.instanceId, { a: 9 });
    expect(next?.state).toEqual({ a: 9 });
    expect(next?.state).not.toHaveProperty("b");
  });

  it("setInstanceState resolution implies the state is durably on disk", async () => {
    // Store writes are coalesced+async; the flush protocol acks persisted=true
    // when the setInstanceState IPC resolves, so resolution must mean "on
    // disk", not "in the cache". A fresh manager reading the same file is the
    // proof.
    const def = mgr.installWidget({ title: "S", spec: { ...SPEC, state: {} } });
    const instance = place(def.id);
    await mgr.setInstanceState(instance.instanceId, { draft: "typed text" });

    const reopened = new ShellManager(storePath);
    expect(reopened.getInstance(instance.instanceId)?.state).toEqual({ draft: "typed text" });
  });

  it("applies a revision-checked RFC 6902 replace", () => {
    const def = mgr.installWidget({ id: "p", title: "P", spec: SPEC });
    const patched = mgr.patchWidgetSpec({
      id: def.id,
      expectedRevision: def.revision,
      ops: [{ op: "replace", path: "/elements/r/props/text", value: "bye" }],
    });
    expect(source(patched).spec.elements["r"]?.props?.["text"]).toBe("bye");
    expect(patched.revision).toBe(2);
  });

  it("rejects empty patches", () => {
    const def = mgr.installWidget({ id: "p", title: "P", spec: SPEC });
    expect(() =>
      mgr.patchWidgetSpec({
        id: def.id,
        expectedRevision: def.revision,
        ops: [],
      }),
    ).toThrow(/at least one op/);
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

  it("treats a minW/minH change as a real geometry update", () => {
    const placed = place("tasks", "pinned");
    if (placed.placement.surface !== "pinned") throw new Error("expected pinned");
    const before = placed.placement.geometry;
    // Same x/y/w/h, but a smaller minW — without this, geometryEquals would
    // call them equal, the renderer's reconcile would reuse the old instance
    // reference, and react-grid-layout would never see the new constraint.
    mgr.setGeometries({
      [placed.instanceId]: { x: before.x, y: before.y, w: before.w, h: before.h, minW: 1, minH: 1 },
    });
    const updated = must(mgr.getInstance(placed.instanceId), "missing");
    if (updated.placement.surface !== "pinned") throw new Error("expected pinned");
    expect(updated.placement.geometry.minW).toBe(1);
    expect(updated.placement.geometry.minH).toBe(1);
    // Instance ref must change so the reconciler picks it up downstream.
    expect(updated).not.toBe(placed);
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
