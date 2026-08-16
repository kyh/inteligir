// ---------------------------------------------------------------------------
// Putting the object's bytes under `./vault` — and refusing a path that would
// land them anywhere else.
//
// The caller is the user's own Durable Object, so a traversing path is a bug
// rather than an attack; it is refused rather than clamped for exactly that
// reason, and the refusal is what makes the bug visible instead of writing
// somebody's note over `/etc`.
// ---------------------------------------------------------------------------

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bytesToBase64 } from "../protocol";
import { materialize, vaultPath } from "../vault-materialize";
import type { VaultWatcher } from "../vault-watcher";

const encode = (text: string): string => bytesToBase64(new TextEncoder().encode(text));

/** Records what the materializer announced, which is the whole reason a push
 * does not come back as an agent edit. */
function recordingWatcher(): VaultWatcher & { announced: string[]; resets: number } {
  const announced: string[] = [];
  return {
    announced,
    resets: 0,
    start() {},
    stop() {},
    noteSelfChange(relPath) {
      announced.push(relPath);
      return Promise.resolve();
    },
    reset() {
      this.resets += 1;
    },
  };
}

describe("vaultPath", () => {
  it("resolves an ordinary vault-relative path", () => {
    expect(vaultPath("/vault", "notes/a.md")).toBe("/vault/notes/a.md");
  });

  it("refuses everything that would land outside the vault", () => {
    for (const escape of [
      "../outside.md",
      "notes/../../outside.md",
      "/etc/passwd",
      "",
      ".",
      "..",
    ]) {
      expect(vaultPath("/vault", escape), escape).toBe(null);
    }
  });

  it("allows a path that only traverses INSIDE the vault", () => {
    expect(vaultPath("/vault", "notes/../a.md")).toBe("/vault/a.md");
  });
});

describe("materialize", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "inteligir-vault-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the pushed bytes and announces each one as the daemon's own", async () => {
    const watcher = recordingWatcher();
    const outcome = await materialize(dir, watcher, {
      toRevision: 3,
      replaceAll: false,
      upserted: [{ path: "notes/a.md", bytesBase64: encode("# A\n") }],
      removed: [],
    });
    expect(outcome).toEqual({ ok: true });
    expect(await readFile(join(dir, "notes/a.md"), "utf8")).toBe("# A\n");
    expect(watcher.announced).toEqual(["notes/a.md"]);
  });

  it("refuses a traversing path instead of clamping it", async () => {
    const watcher = recordingWatcher();
    const outcome = await materialize(dir, watcher, {
      toRevision: 3,
      replaceAll: false,
      upserted: [{ path: "../escaped.md", bytesBase64: encode("nope") }],
      removed: [],
    });
    expect(outcome).toMatchObject({ ok: false });
    expect(watcher.announced).toEqual([]);
  });

  it("refuses a traversing REMOVAL too", async () => {
    const watcher = recordingWatcher();
    const outcome = await materialize(dir, watcher, {
      toRevision: 3,
      replaceAll: false,
      upserted: [],
      removed: ["../../elsewhere.md"],
    });
    expect(outcome).toMatchObject({ ok: false });
  });

  it("refuses bytes that are not base64 rather than writing rubbish", async () => {
    const watcher = recordingWatcher();
    const outcome = await materialize(dir, watcher, {
      toRevision: 3,
      replaceAll: false,
      upserted: [{ path: "a.md", bytesBase64: "!!!not base64!!!" }],
      removed: [],
    });
    expect(outcome).toMatchObject({ ok: false });
  });

  it("replaceAll wipes what the container held and re-watches the new directory", async () => {
    await writeFile(join(dir, "stale.md"), "left over");
    const watcher = recordingWatcher();
    const outcome = await materialize(dir, watcher, {
      toRevision: 4,
      replaceAll: true,
      upserted: [{ path: "fresh.md", bytesBase64: encode("new") }],
      removed: [],
    });
    expect(outcome).toEqual({ ok: true });
    expect(watcher.resets).toBe(1);
    await expect(readFile(join(dir, "stale.md"), "utf8")).rejects.toThrow();
    expect(await readFile(join(dir, "fresh.md"), "utf8")).toBe("new");
  });
});
