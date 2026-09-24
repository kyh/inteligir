import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { VaultFilesChange } from "../vault-changes";
import { createVaultRuntime } from "../vault-runtime";
import { makeTempDir } from "../../__tests__/temp-dir";
import { hermeticGitEnv } from "./git-test-env";
import { createNotifierRecorder } from "./notifier-recorder";
import { scriptedWatcher } from "./scripted-watcher";

// far past the watcher's debounce; a delivery that never comes fails at this bound.
const DELIVERY_TIMEOUT_MS = 5000;

const bootRuntime = async () => {
  const vaultDir = makeTempDir("inteligir-echo-vault-", { realpath: true });
  const watcher = scriptedWatcher();
  const changes: VaultFilesChange[] = [];
  const traced: string[] = [];
  const runtime = await createVaultRuntime({
    dataDir: makeTempDir("inteligir-echo-data-"),
    debugLog: (line) => {
      traced.push(line);
    },
    gitEnv: hermeticGitEnv(),
    notifier: createNotifierRecorder(),
    onFilesChanged: (change) => {
      changes.push(change);
    },
    remote: () => null,
    syncIntervalMs: null,
    vaultDir,
    watcherBackend: watcher.backend,
  });
  onTestFinished(async () => {
    await runtime.dispose();
  });

  const writeExternally = async (relPath: string, content: string): Promise<void> => {
    await writeFile(path.join(vaultDir, relPath), content, "utf-8");
  };
  // resolves on the next delivery. an external edit reported in the same batch as an echo
  // bounds the wait for the echo's absence, so no negative waits on a sleep.
  const report = async (...relPaths: string[]): Promise<VaultFilesChange | undefined> => {
    const delivered = changes.length;
    watcher.emit(...relPaths.map((relPath) => path.join(vaultDir, relPath)));
    await vi.waitFor(
      () => {
        expect(changes.length).toBeGreaterThan(delivered);
      },
      { timeout: DELIVERY_TIMEOUT_MS },
    );
    return changes.at(-1);
  };
  return { report, runtime, traced, writeExternally };
};

describe("the runtime's self-write echo filter", { timeout: 20_000 }, () => {
  it("drops a save's own echo, and delivers a foreign write that lands right behind it", async () => {
    const { report, runtime, writeExternally } = await bootRuntime();
    await runtime.service.write("note.md", "ours\n");

    await writeExternally("other.md", "an external edit\n");
    expect(await report("note.md", "other.md")).toEqual({ kind: "paths", paths: ["other.md"] });

    await writeExternally("note.md", "an agent's edit\n");
    expect(await report("note.md")).toEqual({ kind: "paths", paths: ["note.md"] });
  });

  it("drops a delete's echo, and delivers the note recreated behind it", async () => {
    const { report, runtime, writeExternally } = await bootRuntime();
    await runtime.service.write("gone.md", "ours\n");
    await runtime.service.remove("gone.md");

    await writeExternally("other.md", "an external edit\n");
    expect(await report("gone.md", "other.md")).toEqual({ kind: "paths", paths: ["other.md"] });

    await writeExternally("gone.md", "recreated\n");
    expect(await report("gone.md")).toEqual({ kind: "paths", paths: ["gone.md"] });
  });

  it("drops a rename's echoes at both ends, and delivers a write to the new name", async () => {
    const { report, runtime, writeExternally } = await bootRuntime();
    await runtime.service.write("before.md", "ours\n");
    await runtime.service.rename("before.md", "after.md");

    await writeExternally("other.md", "an external edit\n");
    expect(await report("after.md", "before.md", "other.md")).toEqual({
      kind: "paths",
      paths: ["other.md"],
    });

    await writeExternally("after.md", "an agent's edit\n");
    expect(await report("after.md")).toEqual({ kind: "paths", paths: ["after.md"] });
  });

  it("traces the echo it dropped and the paths it delivered", async () => {
    const { report, runtime, traced, writeExternally } = await bootRuntime();
    await runtime.service.write("note.md", "ours\n");
    await writeExternally("other.md", "an external edit\n");
    await report("note.md", "other.md");

    expect(traced).toContain("note.md: dropped, the echo of this server's own write");
    expect(traced).toContain("delivered: other.md");
  });
});
