import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readServerFile } from "inteligir/server/server-file";
import { parseEval } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { SHELL_APP_URL, SHELL_FIRST_RUN_URL } from "../harness/desktop-shell";
import type { DesktopShell, ShellPage } from "../harness/desktop-shell";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

// where main opens the app window after a first run (apps/desktop/src/main/index.ts)
const WELCOME_URL = `${SHELL_APP_URL}welcome`;
const WELCOME_NOTE = "Welcome.md";
// the seeded note's heading (apps/cli/seed/Welcome.md)
const WELCOME_HEADING = "Welcome to inteligir";
const FINISH_LINE = "Your vault is ready";
const BOOT_DEADLINE_MS = 90_000;
const EDITOR_DEADLINE_MS = 30_000;

interface ShellState {
  pages: ShellPage[];
  serving: boolean;
}

const shellState = async (shell: DesktopShell): Promise<ShellState> => ({
  pages: await shell.appPages(),
  serving: readServerFile(shell.target().dataDir) !== null,
});

export const desktopOnboarding: Scenario = {
  description:
    "the built shell on a fresh home opens only its first run, with no server; Create with the defaults boots the default vault and replaces the page with the app on /welcome over the seeded vault; finishing shows Welcome.md; a relaunch goes straight to the app",
  name: "desktop-onboarding",
  // a cold run downloads the Electron binary, and the shell launches twice
  timeoutMs: 300_000,
  async run(ctx) {
    const shell = await ctx.desktopShell({ firstRun: true });
    const { dataDir, vaultDir } = shell.target();

    ctx.log("a fresh home shows the first run alone, and nothing boots before a vault is chosen");
    const fresh = await shellState(shell);
    expectEq(
      fresh.pages.map((page) => page.url),
      [SHELL_FIRST_RUN_URL],
      "the pages on a fresh home",
    );
    expect(!fresh.serving, `a server published itself in ${dataDir} before any vault was chosen`);
    expect(!existsSync(vaultDir), `${vaultDir} was made before the first run chose it`);

    const browser = await ctx.browser("desktop-onboarding");
    await browser(["connect", String(shell.cdpPort)], 60_000);
    await browser(["find", "role", "button", "click", "--name", "Get started", "--exact"]);
    await browser(["find", "role", "button", "click", "--name", "Create vault", "--exact"]);

    ctx.log("Create with the defaults boots the default vault and opens the app on /welcome");
    const opened = await pollUntil(
      async () => await shellState(shell),
      (state) =>
        state.serving &&
        state.pages.length === 1 &&
        (state.pages[0]?.url.startsWith(WELCOME_URL) ?? false),
      {
        deadlineMs: BOOT_DEADLINE_MS,
        describe: (state) =>
          `the first run never handed over: serving ${String(state.serving)}, pages ${JSON.stringify(state.pages)}`,
      },
    );
    expect(
      opened.pages.every((page) => page.url !== SHELL_FIRST_RUN_URL),
      "the first-run page outlived the boot",
    );
    expect(existsSync(path.join(vaultDir, WELCOME_NOTE)), `the new vault holds no ${WELCOME_NOTE}`);
    const { content } = await shell.api.vault.read({ path: WELCOME_NOTE });
    expect(content.includes(WELCOME_HEADING), `the server reads another vault:\n${content}`);

    ctx.log("finishing uncovers the workspace on Welcome.md");
    // the first-run page closed with its window; the app window is the only page left to bind,
    // and its url names /welcome before the route has drawn
    await browser(["connect", String(shell.cdpPort)], 60_000);
    await browser(["wait", "--text", FINISH_LINE], EDITOR_DEADLINE_MS);
    await browser(["find", "role", "button", "click", "--name", "Open my notes", "--exact"]);
    const covered = `document.body.textContent.includes(${JSON.stringify(FINISH_LINE)}) ? "covered" : "uncovered"`;
    await pollUntil(
      async () => parseEval(await browser(["eval", covered]), z.string()),
      (state) => state === "uncovered",
      {
        deadlineMs: EDITOR_DEADLINE_MS,
        describe: () => "the welcome layer never left the workspace",
      },
    );
    await pollUntil(
      async () => await browser(["get", "text", EDITOR]),
      (text) => text.includes(WELCOME_HEADING),
      {
        deadlineMs: EDITOR_DEADLINE_MS,
        describe: (text) => `the workspace is not on ${WELCOME_NOTE}; the editor holds:\n${text}`,
      },
    );

    ctx.log("a relaunch finds the vault the first run made and goes straight to the app");
    await shell.quit();
    const again = await ctx.desktopShell({ firstRun: true });
    const relaunched = await pollUntil(
      async () => await shellState(again),
      (state) => state.serving && state.pages.length > 0,
      {
        deadlineMs: BOOT_DEADLINE_MS,
        describe: (state) =>
          `the relaunch never served its vault: serving ${String(state.serving)}, pages ${JSON.stringify(state.pages)}`,
      },
    );
    expect(
      relaunched.pages.every((page) => page.url !== SHELL_FIRST_RUN_URL),
      `the relaunch asked for a vault again: ${JSON.stringify(relaunched.pages)}`,
    );
    await again.quit();
  },
};
