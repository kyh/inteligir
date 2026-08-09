// The ordering rules `vault-session` owns, driven over a fake vault.
//
// Everything the session composes is covered elsewhere; what is only reachable
// here is the ORDER, so every case sets up the race and asserts what the note
// ended up as. The vault is a map, its listings and its rename are gated so a
// case can land them out of order, and nothing React is involved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeleteVaultEntryResult, VaultEntry } from "@repo/bridge/vault";
import type { VaultEditorState } from "@repo/editor/vault-editor";
import { basenamePath } from "@repo/notes/knowledge/vault-path";

import {
  createVaultSession,
  type NoticeLevel,
  type VaultSessionPorts,
} from "@repo/workspace/workspace/vault-session";

const ROOT = "/vault";

/** Fake timers leave microtasks alone, so draining the queue a few hops is
 * what lets the controller's async open/read/write chains land. */
const settle = async (): Promise<void> => {
  for (let hop = 0; hop < 20; hop += 1) await Promise.resolve();
};

/** A promise a case lands by hand — how a listing or a rename is held open long
 * enough for something else to race it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value) => settle?.(value) };
}

function entry(path: string): VaultEntry {
  return { path, name: basenamePath(path), kind: "doc" };
}

type HarnessOptions = {
  /** The note the boot bundle says was open. */
  readonly open?: string;
  /** Hold the boot open so a case can act before it lands. */
  readonly deferBoot?: boolean;
};

function harness(seed: Record<string, string> = {}, options: HarnessOptions = {}) {
  const files = new Map(Object.entries(seed));
  const listings: VaultEntry[][] = [];
  const roots: string[] = [];
  const openPaths: Array<string | null> = [];
  const editors: VaultEditorState[] = [];
  const notices: Array<{ level: NoticeLevel; message: string }> = [];
  let bootCalls = 0;
  let surfaceShown = 0;
  let refreshes = 0;

  const bootGate = deferred<void>();
  /** Per-case overrides. */
  const hooks = {
    /** Answer listings from here instead of the map. */
    list: null as null | (() => Promise<VaultEntry[]>),
    /** Run while the rename is still in flight — where the host's own
     * broadcast for that rename lands. */
    duringRename: null as null | (() => Promise<void>),
    renameRefusal: null as null | string,
    writeFails: false,
    removeOutcome: { outcome: "trashed" } as DeleteVaultEntryResult,
  };

  const listing = (): VaultEntry[] => [...files.keys()].toSorted().map(entry);

  const ports: VaultSessionPorts = {
    boot: async () => {
      bootCalls += 1;
      if (options.deferBoot === true) await bootGate.promise;
      const path = options.open;
      return {
        root: ROOT,
        entries: listing(),
        uiState: {},
        openNote: path === undefined ? null : { path, content: files.get(path) ?? "" },
      };
    },
    list: () => hooks.list?.() ?? Promise.resolve(listing()),
    refresh: () => {
      refreshes += 1;
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(files.has(path)),
    rename: async (from, to) => {
      if (hooks.renameRefusal !== null) return { ok: false, error: hooks.renameRefusal };
      files.set(to, files.get(from) ?? "");
      files.delete(from);
      await hooks.duringRename?.();
      return { ok: true };
    },
    note: {
      read: (path) => {
        const text = files.get(path);
        return text === undefined ? Promise.reject(new Error("ENOENT")) : Promise.resolve(text);
      },
      write: (path, content) => {
        if (hooks.writeFails) return Promise.reject(new Error("disk full"));
        files.set(path, content);
        return Promise.resolve();
      },
      remove: (path) => {
        if (hooks.removeOutcome.outcome !== "held") files.delete(path);
        return Promise.resolve(hooks.removeOutcome);
      },
    },
    publishListing: (next) => listings.push(next),
    publishRoot: (next) => roots.push(next),
    publishOpenPath: (next) => openPaths.push(next),
    publishEditor: (next) => editors.push(next),
    showEditor: () => {
      surfaceShown += 1;
    },
    notify: (level, message) => notices.push({ level, message }),
    settleAiSession: () => null,
  };

  return {
    session: createVaultSession(ports),
    files,
    listings,
    roots,
    openPaths,
    notices,
    hooks,
    releaseBoot: () => bootGate.resolve(),
    bootCalls: () => bootCalls,
    surfaceShown: () => surfaceShown,
    refreshes: () => refreshes,
    /** The open note as the UI last saw it. */
    editor: (): VaultEditorState | undefined => editors.at(-1),
  };
}

/** Boot a session with one note open and let its bytes land. */
async function opened(seed: Record<string, string>, open: string) {
  const h = harness(seed, { open });
  await h.session.start();
  await settle();
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a rename of the OPEN note", () => {
  it("survives the broadcast the rename itself causes", async () => {
    const h = await opened({ "notes/a.md": "# A" }, "notes/a.md");
    // The host announces the move while the rename call is still in flight —
    // which is exactly when it happens in production.
    h.hooks.duringRename = async () => {
      h.session.handleVaultChanged({
        root: ROOT,
        changed: { upserted: ["notes/b.md"], removed: ["notes/a.md"] },
      });
      await settle();
    };

    expect(await h.session.actions.renameEntry("notes/a.md", "notes/b.md")).toBe(true);
    await settle();

    // Carried over, with its bytes — not closed by a controller that reloaded
    // the path the rename had already emptied.
    expect(h.openPaths.at(-1)).toBe("notes/b.md");
    expect(h.editor()?.path).toBe("notes/b.md");
    expect(h.editor()?.content).toBe("# A");
  });

  it("refuses to rename when the pending edits will not save", async () => {
    const h = await opened({ "a.md": "A" }, "a.md");
    h.hooks.writeFails = true;
    h.session.actions.editNote("a.md", "unsaveable");

    expect(await h.session.actions.renameEntry("a.md", "b.md")).toBe(false);
    await settle();

    expect(h.files.has("a.md")).toBe(true);
    expect(h.notices.at(-1)?.message).toContain("Couldn't save");
  });

  it("re-attaches the note when the host refuses the move", async () => {
    const h = await opened({ "a.md": "A" }, "a.md");
    h.hooks.renameRefusal = "a file already lives there";

    expect(await h.session.actions.renameEntry("a.md", "b.md")).toBe(false);
    await settle();

    expect(h.notices.at(-1)).toEqual({
      level: "error",
      message: "a file already lives there",
    });
    // Still open AND still live: a refused rename must not leave a note whose
    // keystrokes go nowhere.
    h.session.actions.editNote("a.md", "still editable");
    expect(h.editor()?.content).toBe("still editable");
  });
});

describe("navigating away", () => {
  it("refuses when the current note's edits will not save", async () => {
    const h = await opened({ "a.md": "A", "b.md": "B" }, "a.md");
    h.hooks.writeFails = true;
    h.session.actions.editNote("a.md", "unsaveable");

    h.session.actions.openFile("b.md");
    await settle();

    expect(h.openPaths.at(-1)).toBe("a.md");
    expect(h.editor()?.path).toBe("a.md");
    expect(h.notices.at(-1)?.message).toContain("resolve that before switching");
  });

  it("shows the editor surface even when the note is already the open one", async () => {
    const h = await opened({ "a.md": "A" }, "a.md");
    h.session.actions.openFile("a.md");
    await settle();
    // Clicking the open note in the graph still has to leave the graph.
    expect(h.surfaceShown()).toBe(1);
  });
});

describe("overlapping listings", () => {
  it("applies them in ISSUE order, never arrival order", async () => {
    const h = await opened({ "a.md": "A" }, "a.md");
    const first = deferred<VaultEntry[]>();
    const second = deferred<VaultEntry[]>();
    const queue = [first.promise, second.promise];
    h.hooks.list = () => queue.shift() ?? Promise.resolve([]);

    // A refresh describes no change at all, so both re-list.
    h.session.handleVaultChanged({ root: ROOT, changed: null });
    h.session.handleVaultChanged({ root: ROOT, changed: null });

    second.resolve([entry("newer.md")]);
    await settle();
    first.resolve([entry("stale.md")]);
    await settle();

    expect(h.listings.at(-1)).toEqual([entry("newer.md")]);
  });
});

describe("a root switch", () => {
  it("drops the open note, whose path belongs to the vault that went away", async () => {
    const h = await opened({ "a.md": "A" }, "a.md");

    h.session.handleVaultChanged({ root: "/somewhere-else", changed: null });
    await settle();

    expect(h.openPaths.at(-1)).toBeNull();
    expect(h.roots.at(-1)).toBe("/somewhere-else");
  });
});

describe("the boot bundle", () => {
  it("never opens over a note the user already chose", async () => {
    const h = harness({ "a.md": "A", "b.md": "B" }, { open: "a.md", deferBoot: true });
    void h.session.start();
    // The click beats the boot.
    h.session.actions.openFile("b.md");
    await settle();

    h.releaseBoot();
    await settle();

    expect(h.openPaths.at(-1)).toBe("b.md");
    expect(h.editor()?.path).toBe("b.md");
    expect(h.editor()?.content).toBe("B");
  });

  it("applies nothing once the session has stopped", async () => {
    const h = harness({ "a.md": "A" }, { open: "a.md", deferBoot: true });
    void h.session.start();
    h.session.stop();

    h.releaseBoot();
    await settle();

    expect(h.openPaths).toEqual([]);
    expect(h.listings).toEqual([]);
  });
});

describe("a session's own lifecycle", () => {
  it("is INERT until it is started, and startable again after it stops", async () => {
    const h = harness({ "a.md": "A" }, { open: "a.md" });
    // Construction asks the vault nothing and publishes nothing, which is what
    // lets React build one and throw it away.
    expect(h.bootCalls()).toBe(0);
    expect(h.listings).toEqual([]);
    expect(h.openPaths).toEqual([]);

    await h.session.start();
    await settle();
    expect(h.editor()?.content).toBe("A");

    h.session.stop();
    await h.session.start();
    await settle();
    expect(h.editor()?.path).toBe("a.md");
  });
});

describe("deleting", () => {
  it("leaves the note open when the host HELDS the delete, and says why", async () => {
    const h = await opened({ "a.md": "A" }, "a.md");
    h.hooks.removeOutcome = {
      outcome: "held",
      held: { deletions: 40, liveCount: 100, limit: 25, sample: ["a.md"] },
    };

    await h.session.actions.deleteEntry("a.md");
    await settle();

    expect(h.files.has("a.md")).toBe(true);
    expect(h.openPaths.at(-1)).toBe("a.md");
    expect(h.notices.at(-1)?.level).toBe("warning");
  });

  it("closes the note when the file actually went", async () => {
    const h = await opened({ "a.md": "A" }, "a.md");

    await h.session.actions.deleteEntry("a.md");
    await settle();

    expect(h.files.has("a.md")).toBe(false);
    expect(h.openPaths.at(-1)).toBeNull();
    expect(h.notices).toEqual([]);
  });
});

describe("open-or-create", () => {
  it("leaves an existing file byte-exact rather than seeding over it", async () => {
    const h = await opened({ "journal/today.md": "yesterday's words" }, "a.md");

    const path = await h.session.actions.createFileAt("journal/today.md", "# Template\n");
    expect(path).toBe("journal/today.md");
    expect(h.files.get("journal/today.md")).toBe("yesterday's words");
  });

  it("refuses a name the vault cannot hold, without writing anything", async () => {
    const h = await opened({ "a.md": "A" }, "a.md");

    expect(await h.session.actions.createFileAt("bad:name")).toBeNull();
    expect(h.files.has("bad:name.md")).toBe(false);
    expect(h.notices.at(-1)?.level).toBe("error");
  });
});
