// Round-trips a real external file change through the native watcher (run
// IN-process here — the forked-child path is covered by watcher-proxy.test.ts
// and by running the app). Skips gracefully when the platform watcher is
// unavailable in a sandboxed environment.

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import parcelWatcher from "@parcel/watcher";
import { afterEach, describe, expect, it } from "vitest";
import { createVaultWatcher, type VaultWatcher } from "../watcher";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

const PROBE_TIMEOUT_MS = 5_000;

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

describe("the vault watcher over the real backend", () => {
  it(
    "fires a debounced batch for an external write, ignoring .git and staging files",
    {
      timeout: 20_000,
    },
    async (ctx) => {
      const root = mkdtempSync(join(tmpdir(), "inteligir-watch-test-"));
      cleanups.push(() => rmSync(root, { recursive: true, force: true }));
      await mkdir(join(root, ".git"), { recursive: true });

      const batches: string[][] = [];
      const errors: string[] = [];
      const watcher: VaultWatcher = createVaultWatcher({
        root,
        backend: parcelWatcher,
        onChanged: (paths) => batches.push([...paths]),
        onError: (message) => errors.push(message),
      });
      cleanups.push(() => watcher.dispose());
      watcher.start();

      // Subscription establishment is asynchronous and unobservable from the
      // outside; probe by writing until an event lands. No event within the
      // window means the platform watcher is unavailable here (a sandboxed CI
      // without FSEvents) — skip rather than fail.
      const probeDeadline = Date.now() + PROBE_TIMEOUT_MS;
      while (batches.length === 0 && Date.now() < probeDeadline) {
        await writeFile(join(root, "note.md"), `probe ${Date.now()}\n`, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (batches.length === 0) {
        ctx.skip();
        return;
      }
      expect(batches.flat()).toContain("note.md");

      // Repo metadata and staging files never surface.
      batches.length = 0;
      await writeFile(join(root, ".git", "index.lock"), "lock", "utf8");
      await writeFile(join(root, ".inteligir-tmp-cafe"), "staging", "utf8");
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(batches).toEqual([]);

      // A real nested write still lands, as a vault-relative POSIX path.
      await mkdir(join(root, "notes"), { recursive: true });
      await writeFile(join(root, "notes", "deep.md"), "external edit\n", "utf8");
      const sawNested = await waitFor(
        () => batches.flat().includes("notes/deep.md"),
        PROBE_TIMEOUT_MS,
      );
      expect(sawNested).toBe(true);
      expect(errors).toEqual([]);
    },
  );
});
