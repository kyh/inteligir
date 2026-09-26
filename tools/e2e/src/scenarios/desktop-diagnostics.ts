import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { askBridge } from "../harness/desktop-shell";
import type { DesktopShell } from "../harness/desktop-shell";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

// the shell's own choice (apps/desktop/src/main/diagnostics.ts) and the log it keeps of the child
// it forks (apps/desktop/src/main/server-log.ts)
const DIAGNOSTICS_FILE = "diagnostics.json";
const SERVER_LOG = path.join("logs", "server.log");
const WATCHED_NOTE = "Traced.md";
const LOG_DEADLINE_MS = 60_000;
const WATCH_ROUND_MS = 5000;

const diagnosticsStateSchema = z.looseObject({
  debug: z.boolean(),
  restartRequired: z.boolean().optional(),
  server: z.string(),
});
const storedChoiceSchema = z.object({ debug: z.boolean() });
const diagnosticsAnswerSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), state: diagnosticsStateSchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

const seedChoice =
  (debug: boolean) =>
  async (userDataDir: string): Promise<void> => {
    await writeFile(path.join(userDataDir, DIAGNOSTICS_FILE), JSON.stringify({ debug }));
  };

const logLines = async (shell: DesktopShell): Promise<string[]> => {
  try {
    const text = await readFile(path.join(shell.target().dataDir, SERVER_LOG), "utf-8");
    return text.split("\n");
  } catch {
    return [];
  }
};

// rewritten each round: the first write can land before the watcher subscribes
const writeUntilTraced = async (shell: DesktopShell): Promise<void> => {
  let round = 0;
  let rewriteAt = 0;
  await pollUntil(
    async () => {
      if (Date.now() >= rewriteAt) {
        await writeFile(
          path.join(shell.target().vaultDir, WATCHED_NOTE),
          `# Traced\n\nround ${round}\n`,
        );
        round += 1;
        rewriteAt = Date.now() + WATCH_ROUND_MS;
      }
      return await logLines(shell);
    },
    (lines) =>
      lines.some((line) => line.includes("[debug:watcher]") && line.includes(WATCHED_NOTE)),
    {
      deadlineMs: LOG_DEADLINE_MS,
      describe: (lines) =>
        `no [debug:watcher] line names ${WATCHED_NOTE} in the server's log:\n${lines.join("\n")}`,
    },
  );
};

export const desktopDiagnostics: Scenario = {
  description:
    "the shell's debug-logging choice, kept in its own userData, reaches the server it forks, whose output always lands in the data dir's logs/server.log: off, the boot line and no trace; on, an external write traced there, and turning it off over the bridge asks for a restart",
  name: "desktop-diagnostics",
  // a cold run downloads the Electron binary, and the shell boots twice
  timeoutMs: 300_000,
  async run(ctx) {
    ctx.log("seeded off: the child's output reaches the log, and none of it is a trace");
    const quiet = await ctx.desktopShell({ seedUserData: seedChoice(false) });
    const booted = await pollUntil(
      async () => await logLines(quiet),
      (lines) => lines.some((line) => line.includes("[boot]")),
      {
        deadlineMs: LOG_DEADLINE_MS,
        describe: (lines) => `the server's boot line never reached its log:\n${lines.join("\n")}`,
      },
    );
    const quietTraces = booted.filter((line) => line.includes("[debug:"));
    expect(quietTraces.length === 0, `debug logging is off, yet:\n${quietTraces.join("\n")}`);
    // the same scratch home: the next launch appends to this log, so its traces are its own
    await quiet.quit();

    ctx.log("seeded on: an external write is traced into the same file");
    const traced = await ctx.desktopShell({ seedUserData: seedChoice(true) });
    await writeUntilTraced(traced);

    ctx.log("the bridge reports the choice, and turning it off asks for a restart");
    const browser = await ctx.browser("desktop-diagnostics");
    await browser(["connect", String(traced.cdpPort)], 60_000);
    const state = await askBridge(
      browser,
      "window.desktopBridge.diagnostics.getState()",
      diagnosticsStateSchema,
    );
    expectEq(state.debug, true, "the bridge's debug choice");
    expectEq(state.server, "owned", "who started the server");
    expectEq(state.restartRequired, false, "a restart asked for before any change");
    const answer = await askBridge(
      browser,
      "window.desktopBridge.diagnostics.setDebug(false)",
      diagnosticsAnswerSchema,
    );
    expect(answer.ok, `setDebug(false) was refused: ${JSON.stringify(answer)}`);
    expectEq(answer.state.debug, false, "the choice setDebug answered");
    expectEq(answer.state.restartRequired, true, "a restart after turning debug logging off");
    const stored = storedChoiceSchema.parse(
      JSON.parse(await readFile(path.join(traced.userDataDir, DIAGNOSTICS_FILE), "utf-8")),
    );
    expectEq(stored.debug, false, "the stored choice");
    await traced.quit();
  },
};
