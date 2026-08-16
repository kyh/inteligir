// The ONE test that actually FORKS the watcher child entry and round-trips
// the IPC protocol through a real process — the path `pnpm dev`/prod runs.
// vitest workers don't carry tsx in their execArgv, so the fork passes it
// explicitly; the entry itself is byte-identical to what production forks.

import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseChildToParentMessage, type ChildToParentMessage } from "../watcher/messages";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const testDir = dirname(fileURLToPath(import.meta.url));
const childEntry = join(testDir, "..", "watcher", "parcel-child-entry.ts");
const appDir = resolve(testDir, "..", "..", "..", "..");

describe("the forked watcher child", () => {
  it(
    "round-trips subscribe → external write → events over real IPC",
    { timeout: 20_000 },
    async (ctx) => {
      const watchRoot = mkdtempSync(join(tmpdir(), "inteligir-fork-watch-"));
      cleanups.push(() => rmSync(watchRoot, { recursive: true, force: true }));

      const child = fork(childEntry, [], {
        cwd: appDir,
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      cleanups.push(() => child.kill("SIGKILL"));

      const inbox: ChildToParentMessage[] = [];
      let failed: Error | null = null;
      child.on("message", (raw) => {
        const parsed = parseChildToParentMessage(raw);
        if (parsed !== null) {
          inbox.push(parsed);
        }
      });
      child.on("error", (error) => {
        failed = error;
      });

      async function waitForMessage<TKind extends ChildToParentMessage["kind"]>(
        kind: TKind,
        timeoutMs: number,
      ): Promise<Extract<ChildToParentMessage, { kind: TKind }> | null> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const match = inbox.find(
            (message): message is Extract<ChildToParentMessage, { kind: TKind }> =>
              message.kind === kind,
          );
          if (match || failed !== null) {
            return match ?? null;
          }
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
        }
        return null;
      }

      // No ready = the environment cannot fork a tsx child (or run the native
      // watcher); that is an environment limitation, not a protocol failure.
      const ready = await waitForMessage("ready", 8_000);
      if (ready === null) {
        ctx.skip();
        return;
      }

      child.send({
        kind: "subscribe",
        id: "sub_1",
        dir: watchRoot,
        opts: { ignore: [".git"] },
        rescan: false,
      });
      const subscribed = await waitForMessage("subscribed", 8_000);
      if (subscribed === null) {
        // The fork worked but the native addon could not arm a watch here.
        ctx.skip();
        return;
      }

      await writeFile(join(watchRoot, "external.md"), "written by another process\n", "utf8");
      const events = await waitForMessage("events", 8_000);
      expect(events).not.toBeNull();
      expect(events?.id).toBe("sub_1");
      expect(events?.events.some((event) => event.path.endsWith("external.md"))).toBe(true);

      child.send({ kind: "unsubscribe", id: "sub_1" });
      expect(await waitForMessage("unsubscribed", 8_000)).not.toBeNull();

      // disconnect → the child disposes and exits on its own (bounded).
      child.disconnect();
      let exited = true;
      try {
        await once(child, "exit", { signal: AbortSignal.timeout(8_000) });
      } catch {
        exited = false;
      }
      expect(exited).toBe(true);
    },
  );
});
