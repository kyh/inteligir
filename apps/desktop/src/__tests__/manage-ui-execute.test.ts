import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ShellManager broadcasts through electron BrowserWindow; keep it inert.
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import uiExtension from "@/agent/ui/extension";
import {
  validateToolParametersSchema,
  type AgentPorts,
  type PiExtensionBundle,
} from "@/agent/extension";
import type { ManageUiParams } from "@/agent/ui/schema";
import { ShellManager } from "@/main/shell";
import type { WidgetSpec } from "@/shared/widget-spec";

// ---------------------------------------------------------------------------
// Harness — drive the REAL execute handler through fake ports backed by a
// real ShellManager on a tmp store, the same injection seam production uses
// (main/lib/agent-lifecycle.ts builds ports; here the test does).
// ---------------------------------------------------------------------------

type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, never>;
};

/** Structural shape of the tool manage_ui registers — captured at register
 * time so the test invokes the exact execute closure production runs. */
type ManageUiTool = {
  name: string;
  parameters: unknown;
  execute: (toolCallId: string, params: ManageUiParams) => Promise<ToolTextResult>;
};

let storePath: string;
let mgr: ShellManager;
let suspended = false;
let failPlace = false;

const unused = (): never => {
  throw new Error("port not used in this test");
};

// The shell port mirrors main/lib/shell-actions.ts semantics: falsy when the
// shell is suspended, throw when the renderer flush fails, otherwise delegate
// to the (real) ShellManager.
const ports: AgentPorts = {
  shell: {
    getWritableShell: () => (suspended ? null : mgr),
    placeWithFlush: async (widgetId, surface) => {
      if (suspended) return null;
      if (failPlace) throw new Error("Renderer flush did not persist pending state");
      return mgr.placeWidget(widgetId, surface);
    },
    unplaceWithFlush: async (instanceId) => (suspended ? false : mgr.unplaceWidget(instanceId)),
    deleteWithFlush: async (widgetId, expectedRevision) =>
      suspended ? false : mgr.deleteWidget(widgetId, expectedRevision),
  },
  tasks: {
    getTasks: () => [],
    createTask: unused,
    toggleTask: unused,
    deleteTask: () => {},
  },
  todos: {
    getTodos: () => [],
    createTodo: unused,
    updateTodo: unused,
    toggleTodo: unused,
    deleteTodo: () => {},
    clearCompleted: () => [],
    sync: async () => ({ ok: true, pulled: 0, pushed: 0, deleted: 0 }),
  },
  executor: {
    cli: { name: "executor", version: "0.0.0", binPath: "/fake/bin/executor" },
    install: async () => {},
    start: async () => false,
    execute: unused,
    resume: unused,
  },
};

let captured: ManageUiTool | null = null;
const fakePi = {
  registerTool: (tool: ManageUiTool) => {
    captured = tool;
  },
  // Minimal ExtensionAPI fake — only registerTool is exercised (same cast
  // pattern as extension.test.ts; test files are exempt from the no-assert rule).
} as unknown as Parameters<ReturnType<PiExtensionBundle["register"]>>[0];

await uiExtension.register({ binDir: "/fake/bin", ports })(fakePi);

function tool(): ManageUiTool {
  if (!captured) throw new Error("manage_ui tool was not registered");
  return captured;
}

async function run(params: ManageUiParams): Promise<string> {
  const result = await tool().execute("call-1", params);
  const first = result.content[0];
  if (!first) throw new Error("tool returned no content");
  return first.text;
}

const SPEC: WidgetSpec = {
  root: "r",
  elements: { r: { type: "Text", props: { text: "hi" } } },
};

function mustDef(id: string) {
  const def = mgr.getDef(id);
  if (!def) throw new Error(`missing def '${id}'`);
  return def;
}

function instancesOf(widgetId: string) {
  return mgr.snapshot().instances.filter((i) => i.widgetId === widgetId);
}

beforeEach(() => {
  storePath = path.join(os.tmpdir(), `manage-ui-test-${Date.now()}-${Math.random()}.json`);
  mgr = new ShellManager(storePath);
  suspended = false;
  failPlace = false;
});

afterEach(() => {
  fs.rmSync(storePath, { force: true });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("manage_ui registration", () => {
  it("registers a schema that passes provider root-shape validation", () => {
    expect(captured).not.toBeNull();
    expect(tool().name).toBe("manage_ui");
    expect(() => validateToolParametersSchema(tool(), "manage_ui")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Read-only actions
// ---------------------------------------------------------------------------

describe("manage_ui list", () => {
  it("lists built-ins, generated defs, and placed instances", async () => {
    const text = await run({ action: "list" });
    expect(text).toContain('chat: "Conversation"');
    // Seed json-ui widgets ship as generated defs, pre-placed.
    expect(text).toContain("- people:");
    expect(text).toContain("Placed instances:");
    expect(text).toMatch(/-> people/);
  });
});

describe("manage_ui catalog", () => {
  it("returns the derived spec-language prose", async () => {
    const text = await run({ action: "catalog" });
    expect(text).toContain("- Stack:");
  });
});

describe("manage_ui read", () => {
  it("requires id", async () => {
    expect(await run({ action: "read" })).toBe("Error: 'id' is required for action 'read'.");
  });

  it("reads a built-in def as JSON", async () => {
    const text = await run({ action: "read", id: "chat" });
    expect(text).toContain('"id": "chat"');
    expect(text).toContain("builtin-react");
  });

  it("reports unknown widgets as a tool error", async () => {
    expect(await run({ action: "read", id: "nope" })).toBe("Error: no widget 'nope'");
  });
});

// ---------------------------------------------------------------------------
// install — def creation AND pinning in one call
// ---------------------------------------------------------------------------

describe("manage_ui install", () => {
  it("installs and pins a new widget in one call", async () => {
    const text = await run({ action: "install", id: "notes", title: "Notes", spec: SPEC });
    expect(text).toMatch(/^Installed 'notes' rev 1 and placed as pinned instance /);
    expect(mustDef("notes").revision).toBe(1);
    const placed = instancesOf("notes");
    expect(placed).toHaveLength(1);
    expect(placed[0]?.placement.surface).toBe("pinned");
  });

  it("requires title and spec", async () => {
    expect(await run({ action: "install", spec: SPEC })).toBe(
      "Error: 'title' is required for action 'install'.",
    );
    expect(await run({ action: "install", title: "Notes" })).toBe(
      "Error: 'spec' is required for action 'install'.",
    );
  });

  it("turns a structurally invalid spec into a tool error string, not a throw", async () => {
    const text = await run({
      action: "install",
      id: "ghosty",
      title: "Ghosty",
      spec: { root: "ghost", elements: {} },
    });
    expect(text).toMatch(/^Error: /);
    expect(text).toContain("root 'ghost' does not exist");
    expect(mgr.getDef("ghosty")).toBeNull();
  });

  it("turns invalid component props into a tool error string", async () => {
    const text = await run({
      action: "install",
      id: "badprops",
      title: "Bad Props",
      spec: { root: "r", elements: { r: { type: "Card", props: { children: "hello" } } } },
    });
    expect(text).toMatch(/^Error: /);
    expect(text).toContain("element 'r' (Card) props.children: Unexpected property");
    expect(mgr.getDef("badprops")).toBeNull();
  });

  it("rejects an id collision with an existing def", async () => {
    expect(await run({ action: "install", id: "chat", title: "Chat 2", spec: SPEC })).toBe(
      "Error: Widget 'chat' already exists",
    );
  });

  it("falls back to install-only success when the auto-place flush fails", async () => {
    failPlace = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const text = await run({ action: "install", id: "notes", title: "Notes", spec: SPEC });
      expect(text).toBe(
        "Installed generated widget 'notes' rev 1. (Auto-place skipped — use action='place' to open it.)",
      );
      expect(mustDef("notes").revision).toBe(1);
      expect(instancesOf("notes")).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("manage_ui update", () => {
  beforeEach(async () => {
    await run({ action: "install", id: "notes", title: "Notes", spec: SPEC });
  });

  it("requires id, expectedRevision, and spec", async () => {
    expect(await run({ action: "update", expectedRevision: 1, spec: SPEC })).toBe(
      "Error: 'id' is required for action 'update'.",
    );
    expect(await run({ action: "update", id: "notes", spec: SPEC })).toBe(
      "Error: 'expectedRevision' is required for action 'update'.",
    );
    expect(await run({ action: "update", id: "notes", expectedRevision: 1 })).toBe(
      "Error: 'spec' is required for action 'update'.",
    );
  });

  it("replaces the spec and bumps the revision", async () => {
    const next: WidgetSpec = {
      root: "r",
      elements: { r: { type: "Text", props: { text: "bye" } } },
    };
    const text = await run({
      action: "update",
      id: "notes",
      expectedRevision: 1,
      title: "Notes 2",
      spec: next,
    });
    expect(text).toBe("Updated generated widget 'notes' to rev 2.");
    const def = mustDef("notes");
    expect(def.title).toBe("Notes 2");
    expect(def.revision).toBe(2);
  });

  it("turns a revision mismatch into a tool error string", async () => {
    const text = await run({ action: "update", id: "notes", expectedRevision: 9, spec: SPEC });
    expect(text).toBe("Error: Widget 'notes' revision mismatch: expected 9, got 1");
    expect(mustDef("notes").revision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// patch — RFC 6902 against the def's spec, pollution-guarded
// ---------------------------------------------------------------------------

describe("manage_ui patch", () => {
  beforeEach(async () => {
    await run({ action: "install", id: "notes", title: "Notes", spec: SPEC });
  });

  it("requires ops", async () => {
    expect(await run({ action: "patch", id: "notes", expectedRevision: 1 })).toBe(
      "Error: 'ops' is required for action 'patch'.",
    );
  });

  it("applies ops and bumps the revision", async () => {
    const text = await run({
      action: "patch",
      id: "notes",
      expectedRevision: 1,
      ops: [{ op: "replace", path: "/elements/r/props/text", value: "bye" }],
    });
    expect(text).toBe("Patched generated widget 'notes' to rev 2.");
    const def = mustDef("notes");
    expect(def.revision).toBe(2);
    if (def.source.kind !== "json-ui") throw new Error("expected json-ui def");
    expect(def.source.spec.elements["r"]?.props["text"]).toBe("bye");
  });

  it("rejects an empty ops array as a tool error", async () => {
    const text = await run({ action: "patch", id: "notes", expectedRevision: 1, ops: [] });
    expect(text).toBe("Error: Widget patch must contain at least one op");
  });

  it("refuses prototype-reserved write targets without polluting Object.prototype", async () => {
    const text = await run({
      action: "patch",
      id: "notes",
      expectedRevision: 1,
      ops: [{ op: "add", path: "/__proto__", value: { polluted: "x" } }],
    });
    expect(text).toMatch(/^Error: Refusing to add prototype-reserved key '__proto__'/);
    const probe: Record<string, unknown> = {};
    expect(probe["polluted"]).toBeUndefined();
    expect(mustDef("notes").revision).toBe(1);
  });

  it("refuses traversal through prototype-reserved keys", async () => {
    const text = await run({
      action: "patch",
      id: "notes",
      expectedRevision: 1,
      ops: [{ op: "add", path: "/constructor/prototype/polluted", value: "x" }],
    });
    expect(text).toMatch(/^Error: Refusing to traverse prototype-reserved key 'constructor'/);
    expect(mustDef("notes").revision).toBe(1);
  });

  it("turns a replace on a missing key into a tool error, leaving the def untouched", async () => {
    const text = await run({
      action: "patch",
      id: "notes",
      expectedRevision: 1,
      ops: [{ op: "replace", path: "/elements/r/props/ghost", value: "x" }],
    });
    expect(text).toMatch(/^Error: Cannot replace missing key 'ghost'/);
    expect(mustDef("notes").revision).toBe(1);
  });

  it("rejects a patch whose result fails spec validation, leaving the def untouched", async () => {
    const text = await run({
      action: "patch",
      id: "notes",
      expectedRevision: 1,
      ops: [{ op: "remove", path: "/elements/r" }],
    });
    expect(text).toMatch(/^Error: .*root 'r' does not exist/);
    expect(mustDef("notes").revision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("manage_ui delete", () => {
  it("deletes the def and every instance of it", async () => {
    await run({ action: "install", id: "notes", title: "Notes", spec: SPEC });
    expect(instancesOf("notes")).toHaveLength(1);
    expect(await run({ action: "delete", id: "notes" })).toBe("Deleted generated widget 'notes'.");
    expect(mgr.getDef("notes")).toBeNull();
    expect(instancesOf("notes")).toHaveLength(0);
  });

  it("reports an unknown widget without throwing", async () => {
    expect(await run({ action: "delete", id: "nope" })).toBe("No generated widget 'nope'.");
  });

  it("turns a revision-guarded delete mismatch into a tool error", async () => {
    await run({ action: "install", id: "notes", title: "Notes", spec: SPEC });
    const text = await run({ action: "delete", id: "notes", expectedRevision: 5 });
    expect(text).toBe("Error: Widget 'notes' revision mismatch: expected 5, got 1");
    expect(mgr.getDef("notes")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// place / unplace
// ---------------------------------------------------------------------------

describe("manage_ui place", () => {
  it("requires id and reports unknown widgets", async () => {
    expect(await run({ action: "place" })).toBe("Error: 'id' is required for action 'place'.");
    expect(await run({ action: "place", id: "nope" })).toBe("Error: no widget 'nope'");
  });

  it("dedupes a built-in singleton — placing twice keeps one instance", async () => {
    const first = await run({ action: "place", id: "chat", surface: "pinned" });
    expect(first).toMatch(/^Placed 'chat' as pinned instance /);
    const onlyInstance = instancesOf("chat")[0];
    if (!onlyInstance) throw new Error("chat was not placed");

    const second = await run({ action: "place", id: "chat", surface: "pinned" });
    expect(second).toBe(`Placed 'chat' as pinned instance ${onlyInstance.instanceId}.`);
    expect(instancesOf("chat")).toHaveLength(1);
  });

  it("allows multiple instances of a generated widget", async () => {
    await run({ action: "install", id: "notes", title: "Notes", spec: SPEC });
    await run({ action: "place", id: "notes", surface: "floating" });
    expect(instancesOf("notes")).toHaveLength(2);
  });
});

describe("manage_ui unplace", () => {
  it("requires instanceId and reports unknown instances", async () => {
    expect(await run({ action: "unplace" })).toBe(
      "Error: 'instanceId' is required for action 'unplace'.",
    );
    expect(await run({ action: "unplace", instanceId: "ghost" })).toBe("Cannot unplace 'ghost'.");
  });

  it("removes a placed instance", async () => {
    await run({ action: "install", id: "notes", title: "Notes", spec: SPEC });
    const placed = instancesOf("notes")[0];
    if (!placed) throw new Error("notes was not placed");
    expect(await run({ action: "unplace", instanceId: placed.instanceId })).toBe(
      `Unplaced '${placed.instanceId}'.`,
    );
    expect(instancesOf("notes")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suspended shell — every action short-circuits before touching the store
// ---------------------------------------------------------------------------

describe("manage_ui while the shell is suspended (signed out)", () => {
  const SUSPENDED = "Error: shell is unavailable (signed out).";

  it("short-circuits reads and writes alike", async () => {
    suspended = true;
    const defsBefore = mgr.snapshot().defs.length;
    const instancesBefore = mgr.snapshot().instances.length;

    expect(await run({ action: "list" })).toBe(SUSPENDED);
    expect(await run({ action: "install", id: "notes", title: "Notes", spec: SPEC })).toBe(
      SUSPENDED,
    );
    expect(await run({ action: "place", id: "chat" })).toBe(SUSPENDED);
    expect(await run({ action: "delete", id: "todo" })).toBe(SUSPENDED);
    expect(await run({ action: "unplace", instanceId: "anything" })).toBe(SUSPENDED);

    expect(mgr.snapshot().defs.length).toBe(defsBefore);
    expect(mgr.snapshot().instances.length).toBe(instancesBefore);
  });
});
