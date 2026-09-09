import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import parcelWatcher from "@parcel/watcher";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createVaultWatcher } from "../watcher";
import type { VaultWatcher } from "../watcher";
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
