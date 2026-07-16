import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaptureManager, type CaptureIo } from "../capture/capture-manager";
import type { FsAdapter } from "../lib/json-store";
import type { CaptureApplyEvent } from "@repo/features/ipc-registry";

const TODAY = "journal/2026-07-16.md";
const NOW = new Date(2026, 6, 16);

/** In-memory FsAdapter for the inbox JsonStore — shared across manager
 * reconstructions to simulate a crash/restart. */
function memoryFs(): FsAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (p) => files.get(p) ?? null,
    write: (p, content) => {
      files.set(p, content);
    },
    rename: (from, to) => {
      const value = files.get(from);
      if (value !== undefined) {
        files.set(to, value);
        files.delete(from);
      }
    },
  };
}

/** In-memory vault IO with an optional read hook so tests can interleave a
 * concurrent writer between the CAS snapshot and the write. */
function memoryVault(seed?: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(seed ?? {}));
  let onRead: (() => void) | null = null;
  const io: CaptureIo = {
    read: (rel) => {
      onRead?.();
      return files.get(rel) ?? null;
    },
    write: (rel, content) => {
      files.set(rel, content);
    },
  };
  return {
    io,
    files,
    setReadHook: (hook: (() => void) | null) => {
      onRead = hook;
    },
  };
}

type Harness = {
  manager: CaptureManager;
  vault: ReturnType<typeof memoryVault>;
  fs: ReturnType<typeof memoryFs>;
  applied: CaptureApplyEvent[];
};

function harness(opts?: {
  fs?: ReturnType<typeof memoryFs>;
  seed?: Record<string, string>;
  template?: string | null;
}): Harness {
  const fs = opts?.fs ?? memoryFs();
  const vault = memoryVault(opts?.seed);
  const applied: CaptureApplyEvent[] = [];
  const manager = new CaptureManager({
    fs,
    path: "/inbox/capture-inbox.json",
    io: vault.io,
    dailyPath: () => TODAY,
    readTemplate: () => opts?.template ?? null,
    onApply: (event) => applied.push(event),
    now: () => NOW,
  });
  return { manager, vault, fs, applied };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enqueue", () => {
  it("broadcasts the apply offer with the daily path and formatted line", () => {
    const h = harness();
    const id = h.manager.enqueue("task", "buy milk");
    expect(h.applied).toEqual([{ id, path: TODAY, line: "- [ ] buy milk" }]);
    // Nothing on disk yet — the renderer gets first refusal.
    expect(h.vault.files.get(TODAY)).toBeUndefined();
  });

  it("persists the entry durably before any ack", () => {
    const fs = memoryFs();
    const h = harness({ fs });
    h.manager.enqueue("append", "hello");
    expect(fs.files.get("/inbox/capture-inbox.json")).toContain("hello");
  });
});

describe("ack", () => {
  it("applied removes the entry without touching disk", () => {
    const h = harness();
    const id = h.manager.enqueue("append", "hello");
    h.manager.ack(id, "applied");
    vi.advanceTimersByTime(10_000);
    expect(h.vault.files.get(TODAY)).toBeUndefined();
    expect(h.fs.files.get("/inbox/capture-inbox.json")).not.toContain("hello");
  });

  it("not-open drains to disk immediately", () => {
    const h = harness({ seed: { [TODAY]: "# Today\n" } });
    const id = h.manager.enqueue("append", "hello");
    h.manager.ack(id, "not-open");
    expect(h.vault.files.get(TODAY)).toBe("# Today\n- hello\n");
    expect(h.fs.files.get("/inbox/capture-inbox.json")).not.toContain("hello");
  });

  it("deferred parks the entry — no timeout drain until a later verdict", () => {
    const h = harness({ seed: { [TODAY]: "" } });
    const id = h.manager.enqueue("append", "hello");
    h.manager.ack(id, "deferred");
    vi.advanceTimersByTime(60_000);
    expect(h.vault.files.get(TODAY)).toBe("");
    expect(h.fs.files.get("/inbox/capture-inbox.json")).toContain("hello");
    // The renderer settles and re-acks.
    h.manager.ack(id, "applied");
    expect(h.fs.files.get("/inbox/capture-inbox.json")).not.toContain("hello");
  });
});

describe("timeout drain", () => {
  it("a lost ack drains after the timeout", () => {
    const h = harness({ seed: { [TODAY]: "notes\n" } });
    h.manager.enqueue("append", "hello");
    vi.advanceTimersByTime(2_000);
    expect(h.vault.files.get(TODAY)).toBe("notes\n- hello\n");
  });

  it("an acked entry never double-lands via the timer", () => {
    const h = harness({ seed: { [TODAY]: "notes\n" } });
    const id = h.manager.enqueue("append", "hello");
    h.manager.ack(id, "applied");
    vi.advanceTimersByTime(10_000);
    expect(h.vault.files.get(TODAY)).toBe("notes\n");
  });
});

describe("drain semantics", () => {
  it("seeds a missing daily note from the template with placeholders applied", () => {
    const h = harness({ template: "# {{title}}\n\ncreated {{date}}\n" });
    const id = h.manager.enqueue("append", "hello");
    h.manager.ack(id, "not-open");
    expect(h.vault.files.get(TODAY)).toBe("# 2026-07-16\n\ncreated 2026-07-16\n- hello\n");
  });

  it("creates an empty-seeded note when no template exists", () => {
    const h = harness();
    const id = h.manager.enqueue("task", "do it");
    h.manager.ack(id, "not-open");
    expect(h.vault.files.get(TODAY)).toBe("- [ ] do it\n");
  });

  it("ensures a separating newline on a file without a trailing one", () => {
    const h = harness({ seed: { [TODAY]: "no trailing newline" } });
    const id = h.manager.enqueue("append", "hello");
    h.manager.ack(id, "not-open");
    expect(h.vault.files.get(TODAY)).toBe("no trailing newline\n- hello\n");
  });

  it("exact-line dedupe makes re-drains idempotent", () => {
    const h = harness({ seed: { [TODAY]: "- hello\n" } });
    const id = h.manager.enqueue("append", "hello");
    h.manager.ack(id, "not-open");
    expect(h.vault.files.get(TODAY)).toBe("- hello\n");
  });

  it("two captures both land, in order", () => {
    const h = harness({ seed: { [TODAY]: "" } });
    const a = h.manager.enqueue("append", "first");
    const b = h.manager.enqueue("task", "second");
    h.manager.ack(a, "not-open");
    h.manager.ack(b, "not-open");
    expect(h.vault.files.get(TODAY)).toBe("- first\n- [ ] second\n");
  });
});

describe("CAS append", () => {
  it("a concurrent write between snapshot and write loses no line", () => {
    const h = harness({ seed: { [TODAY]: "start\n" } });
    const id = h.manager.enqueue("append", "captured");
    // Simulate an autosave flush landing between the CAS snapshot read and
    // the verify read: the first verify sees different bytes, forcing a
    // retry against the fresh content.
    let reads = 0;
    h.vault.setReadHook(() => {
      reads++;
      if (reads === 2) {
        // Right before the verify read returns, another writer replaces the
        // file (a whole-buffer autosave carrying new typing).
        h.vault.files.set(TODAY, "start\nuser typing\n");
      }
    });
    h.manager.ack(id, "not-open");
    h.vault.setReadHook(null);
    // Both the interleaved write and the capture survived.
    expect(h.vault.files.get(TODAY)).toBe("start\nuser typing\n- captured\n");
  });
});

describe("crash recovery", () => {
  it("the inbox survives reconstruction and drains on start", () => {
    const fs = memoryFs();
    const first = harness({ fs, seed: { [TODAY]: "notes\n" } });
    first.manager.enqueue("append", "survivor");
    first.manager.close(); // simulated crash before any ack/drain

    const second = harness({ fs, seed: { [TODAY]: "notes\n" } });
    second.manager.drainPendingCaptures();
    expect(second.vault.files.get(TODAY)).toBe("notes\n- survivor\n");
    expect(fs.files.get("/inbox/capture-inbox.json")).not.toContain("survivor");
  });
});
