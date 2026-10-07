import { existsSync } from "node:fs";
import path from "node:path";
import { readServerFile } from "inteligir/server/server-file";
import { expect, expectEq } from "../harness/assert";
import { SHELL_FIRST_RUN_URL, WINDOW_LOADED } from "../harness/desktop-shell";
import type { DesktopShell } from "../harness/desktop-shell";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

// where the shell opens the app window after a first run (apps/desktop/src-tauri/src/window.rs)
const WELCOME_LOADED = `${WINDOW_LOADED} /welcome`;
const WELCOME_NOTE = "Welcome.md";
// the seeded note's heading (apps/cli/seed/Welcome.md)
const WELCOME_HEADING = "Welcome to inteligir";
const BOOT_DEADLINE_MS = 90_000;
const STEP_DEADLINE_MS = 60_000;

interface ShellState {
  serving: boolean;
  loaded: string[];
}

const shellState = async (shell: DesktopShell): Promise<ShellState> => {
  const target = shell.target();
  const log = await shell.serverLog(target);
  return {
    loaded: log.filter((line) => line.includes(WINDOW_LOADED)),
    serving: readServerFile(target.dataDir) !== null,
  };
};

export const desktopOnboarding: Scenario = {
  description:
    "the built shell on a fresh home opens only its first run, with no server; Create with the defaults boots the default vault and replaces the first run with the app window on /welcome over the seeded vault; a relaunch goes straight to the app",
  name: "desktop-onboarding",
  // the shell launches twice
  timeoutMs: 300_000,
  usesDesktopShell: true,
  async run(ctx) {
    const shell = await ctx.desktopShell({ firstRun: true });
    const { dataDir, vaultDir } = shell.target();
    const page = shell.window;

    ctx.log("a fresh home shows the first run alone, and nothing boots before a vault is chosen");
    expectEq(await page.url(), SHELL_FIRST_RUN_URL, "the window on a fresh home");
    expect(
      readServerFile(dataDir) === null,
      `a server published itself in ${dataDir} before any vault was chosen`,
    );
    expect(!existsSync(vaultDir), `${vaultDir} was made before the first run chose it`);

    // the session opens once the window exists, which can be before React has drawn it
    await page.clickButton("Get started", STEP_DEADLINE_MS);
    // the vault step draws after the click, and a click before it lands on nothing
    await page.waitForText("Where should your notes live?", STEP_DEADLINE_MS);
    await page.clickButton("Create vault", STEP_DEADLINE_MS);

    ctx.log("Create with the defaults boots the default vault and opens the app on /welcome");
    await pollUntil(
      async () => await shellState(shell),
      (state) => state.serving && state.loaded.some((line) => line.includes(WELCOME_LOADED)),
      {
        deadlineMs: BOOT_DEADLINE_MS,
        describe: (state) =>
          `the first run never handed over: serving ${String(state.serving)}, windows loaded ${JSON.stringify(state.loaded)}`,
      },
    );
    // the session's window was the first run's, and the boot closed it
    await pollUntil(
      async () => await page.handles(),
      (handles) => handles.length === 0,
      {
        deadlineMs: STEP_DEADLINE_MS,
        describe: (handles) => `the first-run window outlived the boot: ${JSON.stringify(handles)}`,
      },
    );
    expect(existsSync(path.join(vaultDir, WELCOME_NOTE)), `the new vault holds no ${WELCOME_NOTE}`);
    const { content } = await shell.api.vault.read({ path: WELCOME_NOTE });
    expect(content.includes(WELCOME_HEADING), `the server reads another vault:\n${content}`);

    ctx.log("a relaunch finds the vault the first run made and goes straight to the app");
    await shell.quit();
    const again = await ctx.desktopShell({ firstRun: true });
    const url = await again.window.url();
    expect(
      url.startsWith(`${again.serverOrigin}/`),
      `the relaunch did not open the app on its server: ${url}`,
    );
    expect(readServerFile(dataDir) !== null, `the relaunch serves nothing from ${dataDir}`);
    await again.quit();
  },
};
