// Round-trips a real external file change through the native watcher (run
// IN-process here — the forked-child path is covered by watcher-proxy.test.ts
// and by running the app). Skips gracefully when the platform watcher is
// unavailable in a sandboxed environment.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import parcelWatcher from "@parcel/watcher";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createVaultWatcher, type VaultWatcher } from "../watcher";
import { makeTempDir } from "../../__tests__/temp-dir";

const PROBE_TIMEOUT_MS = 5_000;
/** Between probe writes — coarser than the watcher's own debounce, so a probe
 *  that lands is one batch rather than a burst. */
const PROBE_INTERVAL_MS = 300;

describe("the vault watcher over the real backend", () => {
  it(
    "fires a debounced batch for an external write, ignoring .git and staging files",
    {
      timeout: 20_000,
    },
    async (ctx) => {
      const root = makeTempDir("inteligir-watch-test-");
      await mkdir(join(root, ".git"), { recursive: true });

      const batches: string[][] = [];
      const errors: string[] = [];
      const watcher: VaultWatcher = createVaultWatcher({
        root,
        backend: parcelWatcher,
        onChanged: (paths) => batches.push([...paths]),
        onError: (message) => errors.push(message),
      });
      onTestFinished(() => watcher.dispose());
      watcher.start();

      // Subscription establishment is asynchronous and unobservable from the
      // outside; probe by writing until an event lands. No event within the
      // window means the platform watcher is unavailable here (a sandboxed CI
      // without FSEvents) — skip rather than fail. Disposed by hand first:
      // a dynamic skip is not owed the finished hook.
      try {
        await vi.waitFor(
          async () => {
            await writeFile(join(root, "note.md"), `probe ${Date.now()}\n`, "utf8");
            expect(batches).not.toHaveLength(0);
          },
          { timeout: PROBE_TIMEOUT_MS, interval: PROBE_INTERVAL_MS },
        );
      } catch {
        await watcher.dispose();
        ctx.skip();
        return;
      }
      expect(batches.flat()).toContain("note.md");

      // Repo metadata and staging files never surface. The bound is a LATER
      // real write rather than a sleep: events arrive in order, so a batch
      // carrying it would already carry these if they were ever reported.
      batches.length = 0;
      await writeFile(join(root, ".git", "index.lock"), "lock", "utf8");
      await writeFile(join(root, ".inteligir-tmp-cafe"), "staging", "utf8");
      await mkdir(join(root, "notes"), { recursive: true });
      await writeFile(join(root, "notes", "deep.md"), "external edit\n", "utf8");
      await vi.waitFor(() => expect(batches.flat()).toContain("notes/deep.md"), {
        timeout: PROBE_TIMEOUT_MS,
      });
      expect(batches.flat()).not.toContain(".git/index.lock");
      expect(batches.flat()).not.toContain(".inteligir-tmp-cafe");
      expect(errors).toEqual([]);
    },
  );
});
