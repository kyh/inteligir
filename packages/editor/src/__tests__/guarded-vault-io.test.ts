import { createGuardedVaultIo } from "@repo/editor/guarded-vault-io";
import type {
  GuardedVaultPort,
  GuardedWrite,
  GuardedWriteResult,
} from "@repo/editor/guarded-vault-io";
import { createNoteRuntime } from "@repo/editor/note/note-runtime";
import { VaultEditorController } from "@repo/editor/vault-editor";
import { describe, expect, it, vi } from "vitest";

interface SentWrite {
  readonly path: string;
  readonly content: string;
  readonly guard: GuardedWrite;
}

// A store with a host's CAS: `expected` must name the bytes on disk and `absent` an empty path.
// `beforeWrite` runs ahead of each check with that write's 1-based number, so a test can move the
// disk between a refusal and its retry; `hold` parks every read until the test releases it.
class CasStore implements GuardedVaultPort {
  readonly files: Map<string, string>;
  readonly sent: SentWrite[] = [];
  beforeWrite: ((count: number) => void) | null = null;
  private gate: PromiseWithResolvers<void> | null = null;

  constructor(seed: Readonly<Record<string, string>> = {}) {
    this.files = new Map(Object.entries(seed));
  }

  hold = (): PromiseWithResolvers<void> => {
    this.gate = Promise.withResolvers();
    return this.gate;
  };

  read = async (path: string): Promise<string> => {
    await this.gate?.promise;
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT ${path}`);
    }
    return content;
  };

  write = async (
    path: string,
    content: string,
    guard: GuardedWrite,
  ): Promise<GuardedWriteResult> => {
    this.sent.push({ content, guard, path });
    this.beforeWrite?.(this.sent.length);
    const current = this.files.get(path);
    if (guard.kind === "absent" && current !== undefined) {
      return { kind: "exists" };
    }
    if (guard.kind === "expected" && current === undefined) {
      return { kind: "missing" };
    }
    if (guard.kind === "expected" && current !== undefined && current !== guard.base) {
      return { current, kind: "changed" };
    }
    this.files.set(path, content);
    return { kind: "written" };
  };

  remove = async (path: string): Promise<void> => {
    this.files.delete(path);
  };
}

const NOTE = "notes/plans.md";
const BASE = "# Plans\n\nintro\n\nfooter\n";
const EXTERNAL = `${BASE}external-appended-line\n`;

// the surface stands in for the rich editor: what it types waits in its serialize debounce
// until the runtime drains it.
const openRuntime = async (port: GuardedVaultPort) => {
  const runtime = createNoteRuntime(NOTE, createGuardedVaultIo(port), {
    onVanished: () => {},
  });
  let held: string | null = null;
  runtime.registerPreFlush(() => {
    if (held !== null) {
      runtime.edit(held);
      held = null;
    }
  });
  await vi.waitFor(() => {
    expect(runtime.controller.getState()).toMatchObject({ path: NOTE });
  });
  const surface = {
    type: (next: string): void => {
      held = next;
    },
  };
  return { runtime, surface };
};

describe("the guarded vault io", () => {
  it("creates under the absent guard with no base, and answers exists where a file already is", async () => {
    const store = new CasStore();
    const io = createGuardedVaultIo(store);

    expect(await io.create(NOTE, "# Plans\n")).toStrictEqual({ kind: "created" });
    expect(await io.create(NOTE, "clobber")).toStrictEqual({ kind: "exists" });

    expect(store.sent.map((write) => write.guard)).toStrictEqual([
      { kind: "absent" },
      { kind: "absent" },
    ]);
    expect(store.files.get(NOTE)).toBe("# Plans\n");
  });

  it("writes against the base it read, then against what it wrote", async () => {
    const store = new CasStore({ [NOTE]: "v1" });
    const io = createGuardedVaultIo(store);

    expect(await io.read(NOTE)).toBe("v1");
    expect(await io.write(NOTE, "v2")).toStrictEqual({
      conflicted: false,
      content: "v2",
      kind: "landed",
    });
    expect(await io.write(NOTE, "v3")).toStrictEqual({
      conflicted: false,
      content: "v3",
      kind: "landed",
    });
    expect(store.sent).toStrictEqual([
      { content: "v2", guard: { base: "v1", kind: "expected" }, path: NOTE },
      { content: "v3", guard: { base: "v2", kind: "expected" }, path: NOTE },
    ]);
    expect(store.files.get(NOTE)).toBe("v3");
  });

  it("merges a changed file's current bytes with diff3 and retries against them", async () => {
    const store = new CasStore({ [NOTE]: BASE });
    const io = createGuardedVaultIo(store);
    await io.read(NOTE);

    store.files.set(NOTE, EXTERNAL);

    const landed = await io.write(NOTE, "# Plans\n\nintro rewritten\n\nfooter\n");

    expect(store.sent.map((write) => write.guard)).toStrictEqual([
      { base: BASE, kind: "expected" },
      { base: EXTERNAL, kind: "expected" },
    ]);
    const onDisk = store.files.get(NOTE);
    expect(landed).toStrictEqual({ conflicted: false, content: onDisk, kind: "landed" });
    expect(onDisk).toContain("intro rewritten");
    expect(onDisk).toContain("external-appended-line");
    expect(onDisk).not.toContain("\nintro\n");
  });

  it("says a merge kept the buffer's line over the external change to the same one", async () => {
    const store = new CasStore({ [NOTE]: BASE });
    const io = createGuardedVaultIo(store);
    await io.read(NOTE);

    store.files.set(NOTE, "# Plans\n\nintro by the agent\n\nfooter\n");

    const mine = "# Plans\n\nintro rewritten\n\nfooter\n";
    expect(await io.write(NOTE, mine)).toStrictEqual({
      conflicted: true,
      content: mine,
      kind: "landed",
    });
    expect(store.files.get(NOTE)).toBe(mine);
  });

  it("keeps a merged-in external edit through the controller's next save", async () => {
    const store = new CasStore({ [NOTE]: BASE });
    const controller = new VaultEditorController(createGuardedVaultIo(store));
    await controller.open(NOTE);
    store.files.set(NOTE, EXTERNAL);

    controller.edit("# Plans\n\nintro rewritten\n\nfooter\n");
    await controller.flush();
    const merged = store.files.get(NOTE);
    expect(controller.getState()).toMatchObject({ content: merged, dirty: false });

    controller.edit(`${merged ?? ""}more\n`);
    await controller.flush();
    const onDisk = store.files.get(NOTE);
    expect(onDisk).toContain("intro rewritten");
    expect(onDisk).toContain("external-appended-line");
    expect(onDisk).toContain("more");
  });

  it("merges a keystroke held in the serialize debounce when an external write arrives", async () => {
    const store = new CasStore({ [NOTE]: BASE });
    const { runtime, surface } = await openRuntime(store);
    store.files.set(NOTE, EXTERNAL);

    surface.type("# Plans\n\nintro rewritten\n\nfooter\n");
    runtime.controller.externalChange();
    expect(runtime.controller.getState()).toMatchObject({ dirty: true });

    expect(await runtime.flush()).toBe(true);
    const onDisk = store.files.get(NOTE);
    expect(onDisk).toContain("intro rewritten");
    expect(onDisk).toContain("external-appended-line");
    expect(runtime.controller.getState()).toMatchObject({ content: onDisk });
    runtime.dispose();
  });

  it("merges a keystroke typed while an external reload's read is in flight", async () => {
    const store = new CasStore({ [NOTE]: BASE });
    const { runtime, surface } = await openRuntime(store);
    store.files.set(NOTE, EXTERNAL);

    const gate = store.hold();
    runtime.controller.externalChange();
    surface.type("# Plans\n\nintro rewritten\n\nfooter\n");
    gate.resolve();
    await vi.waitFor(() => {
      expect(runtime.controller.getState()).toMatchObject({
        content: expect.stringContaining("external-appended-line"),
      });
    });

    expect(await runtime.flush()).toBe(true);
    const onDisk = store.files.get(NOTE);
    expect(onDisk).toContain("intro rewritten");
    expect(onDisk).toContain("external-appended-line");
    runtime.dispose();
  });

  it("names a write to a note deleted since it was read as vanished, and never recreates it", async () => {
    const store = new CasStore({ [NOTE]: "v1" });
    const io = createGuardedVaultIo(store);
    await io.read(NOTE);
    store.files.delete(NOTE);

    expect(await io.write(NOTE, "v2")).toStrictEqual({ kind: "vanished" });
    expect(store.files.has(NOTE)).toBe(false);
  });

  it("names a note deleted between the refusal and its retry as vanished", async () => {
    const store = new CasStore({ [NOTE]: BASE });
    const io = createGuardedVaultIo(store);
    await io.read(NOTE);
    store.files.set(NOTE, EXTERNAL);
    store.beforeWrite = (count) => {
      if (count === 2) {
        store.files.delete(NOTE);
      }
    };

    expect(await io.write(NOTE, "mine\n")).toStrictEqual({ kind: "vanished" });
    expect(store.sent).toHaveLength(2);
    expect(store.files.has(NOTE)).toBe(false);
  });

  it("merges once: a retry the file moved under again rejects, and the next save guards on the old base", async () => {
    const store = new CasStore({ [NOTE]: BASE });
    const io = createGuardedVaultIo(store);
    await io.read(NOTE);
    store.files.set(NOTE, EXTERNAL);
    store.beforeWrite = (count) => {
      if (count === 2) {
        store.files.set(NOTE, `${EXTERNAL}again\n`);
      }
    };

    await expect(io.write(NOTE, "mine\n")).rejects.toThrow(/after a merge.*changed/u);
    expect(store.sent).toHaveLength(2);

    store.beforeWrite = null;
    await io.write(NOTE, "mine\n");
    expect(store.sent[2]?.guard).toStrictEqual({ base: BASE, kind: "expected" });
  });

  it("refuses a write for a path it never read rather than guessing a base", async () => {
    const store = new CasStore();
    const io = createGuardedVaultIo(store);

    await expect(io.write(NOTE, "x")).rejects.toThrow(/no base was read/u);
    expect(store.sent).toStrictEqual([]);
  });

  it("forgets a removed note's base, so a write after it guesses nothing", async () => {
    const store = new CasStore({ [NOTE]: "v1" });
    const io = createGuardedVaultIo(store);
    await io.read(NOTE);

    await io.remove(NOTE);

    await expect(io.write(NOTE, "v2")).rejects.toThrow(/no base was read/u);
    expect(store.sent).toStrictEqual([]);
  });
});
