// ---------------------------------------------------------------------------
// Self-write attribution, over a REAL directory and a real `fs.watch`.
//
// The whole module rests on one distinction: a file the DAEMON put there (a
// vault push) must not come back to the object as an agent edit, and a file the
// AGENT wrote must. There is no way to test that against a fake filesystem —
// the mechanism is the mtime the write actually produced — so these cases run
// over a temporary directory and wait the settle window out.
// ---------------------------------------------------------------------------

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VaultOp } from "../protocol";
import { createVaultWatcher, SETTLE_MS, type VaultWatcher } from "../vault-watcher";

/** Long enough for the burst to settle AND the drain to finish. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 300));

describe("the vault watcher", () => {
  let dir = "";
  let watcher: VaultWatcher | null = null;
  let reported: VaultOp[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "inteligir-watch-"));
    reported = [];
    watcher = createVaultWatcher({
      dir,
      report: (ops) => {
        reported.push(...ops);
        return Promise.resolve();
      },
    });
    watcher.start();
  });

  afterEach(async () => {
    watcher?.stop();
    watcher = null;
    await rm(dir, { recursive: true, force: true });
  });

  /** A write the DAEMON made, announced the way `materialize` announces one. */
  async function hostWrite(path: string, text: string): Promise<void> {
    await writeFile(join(dir, path), text);
    await watcher?.noteSelfChange(path);
  }

  it("does not report back the bytes the host just pushed", async () => {
    await hostWrite("pushed.md", "# from the object\n");
    await settled();
    expect(reported).toEqual([]);
  });

  it("reports a file the agent wrote", async () => {
    await writeFile(join(dir, "agent.md"), "# from the agent\n");
    await settled();
    expect(reported).toEqual([{ op: "upsert", path: "agent.md", bytesBase64: expect.any(String) }]);
  });

  it("reports an agent EDIT of a file the host pushed", async () => {
    await hostWrite("shared.md", "original\n");
    await settled();
    expect(reported).toEqual([]);

    // No `noteSelfChange`: this is the agent's own `edit`, on the same path.
    await writeFile(join(dir, "shared.md"), "the agent changed this\n");
    await settled();
    expect(reported.map((op) => op.path)).toEqual(["shared.md"]);
  });

  it("reports a removal only for a file it believed was there", async () => {
    await hostWrite("known.md", "here\n");
    await settled();
    reported = [];

    await rm(join(dir, "known.md"));
    await settled();
    expect(reported).toEqual([{ op: "remove", path: "known.md" }]);

    // A path that was created and gone again inside one settle window was never
    // in the inventory, so there is no deletion to announce — the same rule
    // that stops `fs.watch`'s own directory event reading as a lost note.
    reported = [];
    await writeFile(join(dir, "transient.md"), "blink\n");
    await rm(join(dir, "transient.md"));
    await settled();
    expect(reported).toEqual([]);
  });

  it("forgets everything and keeps watching after a replaceAll reset", async () => {
    await hostWrite("old.md", "old\n");
    await settled();
    watcher?.reset();

    // The handle after a reset must be live: on Linux `fs.watch` binds to an
    // INODE, and a wipe-and-recreate leaves a stale one watching nothing.
    await writeFile(join(dir, "after-reset.md"), "new\n");
    await settled();
    expect(reported.map((op) => op.path)).toEqual(["after-reset.md"]);
  });
});
