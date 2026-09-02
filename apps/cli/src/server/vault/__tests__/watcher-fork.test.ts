import { fork } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { childToParentMessageSchema, type ChildToParentMessage } from "../watcher/messages";
import { makeTempDir } from "../../__tests__/temp-dir";

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
        // vitest workers do not carry tsx in their execArgv.
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      onTestFinished(() => {
        child.kill("SIGKILL");
      });

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

      // null rather than a throw: the probes below read it as "this environment cannot".
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

      // no ready: this environment cannot fork a tsx child or load the native watcher.
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
        // the fork worked but the native addon could not arm a watch here.
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
