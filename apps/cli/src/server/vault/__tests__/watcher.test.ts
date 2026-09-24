import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import parcelWatcher from "@parcel/watcher";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createVaultWatcher } from "../watcher";
import type { VaultWatcher } from "../watcher";
import type {
  ParcelWatcherBackend,
  ParcelWatcherError,
  ParcelWatcherEventBatch,
} from "../watcher/parcel-backend";
import { makeTempDir } from "../../__tests__/temp-dir";

const PROBE_TIMEOUT_MS = 5000;
// coarser than the watcher's debounce so a probe lands as one batch.
const PROBE_INTERVAL_MS = 300;

describe("the vault watcher over the real backend", () => {
  it(
    "fires a debounced batch for an external write, ignoring .git and staging files",
    {
      timeout: 20_000,
    },
    async (ctx) => {
      const root = makeTempDir("inteligir-watch-test-");
      await mkdir(path.join(root, ".git"), { recursive: true });
      // before the subscription: inotify watches a new directory only after its create event
      // lands, so a file written right behind the mkdir can be missed.
      await mkdir(path.join(root, "notes"), { recursive: true });

      const batches: string[][] = [];
      const errors: string[] = [];
      const watcher: VaultWatcher = createVaultWatcher({
        backend: parcelWatcher,
        onChanged: (paths) => {
          batches.push([...paths]);
        },
        onError: (message) => {
          errors.push(message);
        },
        root,
      });
      onTestFinished(async () => {
        await watcher.dispose();
      });
      watcher.start();

      // subscription establishment is unobservable, so probe by writing; no event means no
      // platform watcher (sandboxed ci). dispose by hand: a dynamic skip skips onTestFinished.
      try {
        await vi.waitFor(
          async () => {
            await writeFile(path.join(root, "note.md"), `probe ${Date.now()}\n`, "utf-8");
            expect(batches).not.toHaveLength(0);
          },
          { interval: PROBE_INTERVAL_MS, timeout: PROBE_TIMEOUT_MS },
        );
      } catch {
        await watcher.dispose();
        ctx.skip();
        return;
      }
      expect(batches.flat()).toContain("note.md");

      // a later real write bounds the wait, not a sleep: events arrive in order.
      batches.length = 0;
      await writeFile(path.join(root, ".git", "index.lock"), "lock", "utf-8");
      await writeFile(path.join(root, ".inteligir-tmp-cafe"), "staging", "utf-8");
      await writeFile(path.join(root, "notes", "deep.md"), "external edit\n", "utf-8");
      await vi.waitFor(
        () => {
          expect(batches.flat()).toContain("notes/deep.md");
        },
        {
          timeout: PROBE_TIMEOUT_MS,
        },
      );
      expect(batches.flat()).not.toContain(".git/index.lock");
      expect(batches.flat()).not.toContain(".inteligir-tmp-cafe");
      expect(errors).toEqual([]);
    },
  );
});

describe("the vault watcher's resubscribe backoff", () => {
  it("doubles across failed establishes, and a delivered batch resets it", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const root = makeTempDir("inteligir-watch-backoff-", { realpath: true });
    const listeners: ((error: ParcelWatcherError, events: ParcelWatcherEventBatch) => void)[] = [];
    // the proxy's shape: a subscribe resolves at once, and a failed establish arrives later
    // through the callback.
    const backend: ParcelWatcherBackend = {
      subscribe: async (_dir, listener) => {
        listeners.push(listener);
        return await Promise.resolve({
          unsubscribe: async () => {
            await Promise.resolve();
          },
        });
      },
    };
    const batches: string[][] = [];
    const watcher = createVaultWatcher({
      backend,
      onChanged: (paths) => {
        batches.push([...paths]);
      },
      root,
    });
    onTestFinished(async () => {
      await watcher.dispose();
    });
    watcher.start();
    await vi.advanceTimersByTimeAsync(0);

    const latest = () => {
      const listener = listeners.at(-1);
      if (listener === undefined) {
        throw new Error("the watcher never subscribed");
      }
      return listener;
    };
    const failThenResubscribeAfter = async (delayMs: number): Promise<void> => {
      const subscribed = listeners.length;
      latest()(new Error("establish failed"), []);
      await vi.advanceTimersByTimeAsync(delayMs - 1);
      expect(listeners).toHaveLength(subscribed);
      await vi.advanceTimersByTimeAsync(1);
      expect(listeners).toHaveLength(subscribed + 1);
    };

    await failThenResubscribeAfter(500);
    await failThenResubscribeAfter(1000);
    await failThenResubscribeAfter(2000);

    latest()(null, [{ path: path.join(root, "note.md"), type: "update" }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(batches).toEqual([["note.md"]]);
    await failThenResubscribeAfter(500);
  });
});

describe("the vault watcher's debug trace", () => {
  it("names every event's verdict and why a dropped one was dropped", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const root = makeTempDir("inteligir-watch-trace-", { realpath: true });
    const listeners: ((error: ParcelWatcherError, events: ParcelWatcherEventBatch) => void)[] = [];
    const backend: ParcelWatcherBackend = {
      subscribe: async (_dir, listener) => {
        listeners.push(listener);
        return await Promise.resolve({
          unsubscribe: async () => {
            await Promise.resolve();
          },
        });
      },
    };
    const lines: string[] = [];
    const watcher = createVaultWatcher({
      backend,
      debugLog: (line) => {
        lines.push(line);
      },
      onChanged: () => {
        /* empty */
      },
      root,
    });
    onTestFinished(async () => {
      await watcher.dispose();
    });
    watcher.start();
    await vi.advanceTimersByTimeAsync(0);

    const [listener] = listeners;
    expect(listener).toBeDefined();
    listener?.(null, [
      { path: path.join(root, "notes", "kept.md"), type: "update" },
      { path: path.join(root, ".inteligir-tmp-cafe"), type: "create" },
      { path: path.join(root, ".git", "index.lock"), type: "create" },
      { path: path.join(path.dirname(root), "elsewhere.md"), type: "delete" },
    ]);
    await vi.advanceTimersByTimeAsync(1000);

    expect(lines).toEqual([
      "update notes/kept.md: kept",
      `create ${path.join(root, ".inteligir-tmp-cafe")}: dropped, under ignored entry .inteligir-tmp-cafe`,
      `create ${path.join(root, ".git", "index.lock")}: dropped, under ignored entry .git`,
      `delete ${path.join(path.dirname(root), "elsewhere.md")}: dropped, not beneath the vault root`,
      "flush 1 path(s): notes/kept.md",
    ]);
  });
});
