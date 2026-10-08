import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import type { DesktopShell } from "../harness/desktop-shell";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

// the shell's own choice (apps/desktop/src-tauri/src/diagnostics.rs) and the log it keeps of the
// child it starts (apps/desktop/src-tauri/src/server_log.rs)
const DIAGNOSTICS_FILE = "diagnostics.json";
const LOG_DEADLINE_MS = 60_000;
const PAGE_DEADLINE_MS = 30_000;

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
  async (ownDir: string): Promise<void> => {
    await writeFile(path.join(ownDir, DIAGNOSTICS_FILE), JSON.stringify({ debug }));
  };

const logLines = async (shell: DesktopShell): Promise<string[]> =>
  await shell.serverLog(shell.target());

export const desktopDiagnostics: Scenario = {
  description:
    "the shell's debug-logging choice, kept in its own folder, reaches the server it starts, whose output always lands in the data dir's logs/server.log: off, the boot line and no trace; on, the shell says it started its server tracing, and turning it off over the bridge asks for a restart",
  name: "desktop-diagnostics",
  // the shell boots twice
  timeoutMs: 300_000,
  usesDesktopShell: true,
  async run(ctx) {
    ctx.log("seeded off: the child's output reaches the log, and none of it is a trace");
    const quiet = await ctx.desktopShell({ seedOwnDir: seedChoice(false) });
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

    ctx.log("seeded on: the bridge reports the choice, and turning it off asks for a restart");
    const traced = await ctx.desktopShell({ seedOwnDir: seedChoice(true) });
    // the window's page may still be loading
    await traced.window.waitUntil("window.desktopBridge", PAGE_DEADLINE_MS);
    const state = await traced.window.runAsync(
      "window.desktopBridge.diagnostics.getState().then(done)",
      diagnosticsStateSchema,
    );
    expectEq(state.debug, true, "the bridge's debug choice");
    expectEq(state.server, "owned", "who started the server");
    expectEq(state.restartRequired, false, "a restart asked for before any change");
    const answer = await traced.window.runAsync(
      "window.desktopBridge.diagnostics.setDebug(false).then(done)",
      diagnosticsAnswerSchema,
    );
    expect(answer.ok, `setDebug(false) was refused: ${JSON.stringify(answer)}`);
    expectEq(answer.state.debug, false, "the choice setDebug answered");
    expectEq(answer.state.restartRequired, true, "a restart after turning debug logging off");
    const stored = storedChoiceSchema.parse(
      JSON.parse(await readFile(path.join(traced.ownDir, DIAGNOSTICS_FILE), "utf-8")),
    );
    expectEq(stored.debug, false, "the stored choice");
    await traced.quit();
  },
};
