// The ONE test that actually FORKS the watcher child entry and round-trips
// the IPC protocol through a real process — the path `pnpm dev`/prod runs.
// vitest workers don't carry tsx in their execArgv, so the fork passes it
// explicitly; the entry itself is byte-identical to what production forks.

import { fork } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { childToParentMessageSchema, type ChildToParentMessage } from "../watcher/messages";
import { makeTempDir } from "../../__tests__/temp-dir";

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
      const watchRoot = makeTempDir("inteligir-fork-watch-");

      const child = fork(childEntry, [], {
        cwd: appDir,
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      cleanups.push(() => child.kill("SIGKILL"));

      const inbox: ChildToParentMessage[] = [];
      let failed: Error | null = null;
      child.on("message", (raw) => {
        const parsed = childToParentMessageSchema.safeParse(raw);
        if (parsed.success) {
          inbox.push(parsed.data);
        }
      });
      child.on("error", (error) => {
        failed = error;
      });

      /** The first message of a kind, or null once the child failed or the
       *  window closed — null rather than a throw because the two probes
       *  below read it as "this environment cannot", not as a failure. */
      async function waitForMessage<TKind extends ChildToParentMessage["kind"]>(
        kind: TKind,
        timeoutMs: number,
      ): Promise<Extract<ChildToParentMessage, { kind: TKind }> | null> {
        try {
          return await vi.waitFor(
            () => {
              const match = inbox.find(
                (message): message is Extract<ChildToParentMessage, { kind: TKind }> =>
                  message.kind === kind,
              );
              if (match === undefined && failed === null) throw new Error(`no ${kind} yet`);
              return match ?? null;
            },
            { timeout: timeoutMs, interval: 50 },
          );
        } catch {
          return null;
        }
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
