import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { physicalVaultDir } from "inteligir/server/config";
import { readServerFile } from "inteligir/server/server-file";
import { parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { SHELL_APP_URL } from "../harness/desktop-shell";
import type { DesktopShell, ShellPage, ShellTarget } from "../harness/desktop-shell";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, treeRow } from "../harness/selectors";

const NOTE = "Shell.md";
const SEEDED_TOKEN = "seededshelltoken";
const WRITTEN_TOKEN = "apiwrittenshelltoken";
// a link inside the vault to a file outside it: a lexical check passes it, a physical one cannot
const ESCAPE_LINK = "escape.md";
const SECOND_NOTE = "Elsewhere.md";
const SECOND_TOKEN = "secondvaulttoken";
// the shell's own list (apps/desktop/src/main/vaults.ts): the page may only open a vault it holds
const RECENT_VAULTS_FILE = "recent-vaults.json";
const RAIL_DEADLINE_MS = 60_000;
const EDITOR_DEADLINE_MS = 30_000;
const SWITCH_DEADLINE_MS = 90_000;

const pathActionSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
const vaultsStateSchema = z.looseObject({ current: z.looseObject({ path: z.string() }) });

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// a bridge call awaited in the page; the answer crosses back as a JSON string
const askBridge = async <T>(
  browser: AgentBrowser,
  call: string,
  schema: z.ZodType<T>,
): Promise<T> =>
  parseEval(await browser(["eval", `${call}.then((answer) => JSON.stringify(answer))`]), schema);

const requireServer = (target: ShellTarget) => {
  const server = readServerFile(target.dataDir);
  expect(server !== null, `no server.json in ${target.dataDir}: the shell runs no server there`);
  return server;
};

interface SwitchState {
  target: ShellTarget;
  pages: ShellPage[];
}

const switchedTo = async (shell: DesktopShell): Promise<SwitchState> => ({
  pages: await shell.appPages(),
  target: shell.target(),
});

export const desktopShell: Scenario = {
  description:
    "the built Electron shell over DevTools: inteligir:// serves the page and its API, the socket carries the bearer, the pin and Reveal refuse, a vault switch boots a new child, quit stops it",
  name: "desktop-shell",
  // a cold run downloads the Electron binary and boots the shell twice (the switch)
  timeoutMs: 300_000,
  async run(ctx) {
    const outsideFile = path.join(ctx.scratchDir, "outside", "secret.md");
    await mkdir(path.dirname(outsideFile), { recursive: true });
    await writeFile(outsideFile, "# Secret\n", "utf-8");
    const secondVault = path.join(ctx.scratchDir, "second-vault");
    await mkdir(secondVault, { recursive: true });
    await writeFile(path.join(secondVault, SECOND_NOTE), `# Elsewhere\n\n${SECOND_TOKEN}\n`);

    const shell = await ctx.desktopShell({
      seedUserData: async (userDataDir) => {
        await writeFile(
          path.join(userDataDir, RECENT_VAULTS_FILE),
          JSON.stringify({ vaults: [{ path: secondVault }] }),
        );
      },
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, NOTE), `# Shell\n\n${SEEDED_TOKEN}\n`, "utf-8");
        await symlink(outsideFile, path.join(vaultDir, ESCAPE_LINK));
      },
    });
    const browser = await ctx.browser("desktop-shell");
    await browser(["connect", String(shell.cdpPort)], 60_000);

    const url = await browser(["get", "url"]);
    expect(url.startsWith(SHELL_APP_URL), `the window is not on ${SHELL_APP_URL}: ${url}`);
    const socketOrigin = parseEval(
      await browser(["eval", "window.desktopBridge.socketOrigin"]),
      z.string(),
    );
    expectEq(socketOrigin, shell.serverOrigin, "the preload's socket origin");

    ctx.log("the rail lists the seeded note: the listing rode the protocol handler's bearer");
    await browser(["wait", treeRow(NOTE)], RAIL_DEADLINE_MS);
    await browser(["click", treeRow(NOTE)]);
    const readEditor = async (): Promise<string> => await browser(["get", "text", EDITOR]);
    await pollUntil(readEditor, (text) => text.includes(SEEDED_TOKEN), {
      deadlineMs: EDITOR_DEADLINE_MS,
      describe: (text) => `the editor never opened ${NOTE}; it holds:\n${text}`,
    });

    ctx.log("a write over the API reaches the open editor: the socket upgrade carried the bearer");
    await shell.api.vault.write({
      content: `# Shell\n\n${WRITTEN_TOKEN}\n`,
      guard: { kind: "overwrite" },
      path: NOTE,
    });
    await pollUntil(readEditor, (text) => text.includes(WRITTEN_TOKEN), {
      deadlineMs: EDITOR_DEADLINE_MS,
      describe: (text) => `the editor never heard the write; it holds:\n${text}`,
    });

    ctx.log("window.open is denied, the app's own origin included");
    const opened = parseEval(
      await browser(["eval", `String(window.open(${JSON.stringify(SHELL_APP_URL)}))`]),
      z.string(),
    );
    expectEq(opened, "null", "window.open's answer");
    const pages = await shell.appPages();
    expectEq(pages.length, 1, "pages after window.open");

    ctx.log("Reveal refuses what the vault does not physically contain");
    for (const entry of [ESCAPE_LINK, "../outside/secret.md"]) {
      const answer = await askBridge(
        browser,
        `window.desktopBridge.paths.reveal(${JSON.stringify(entry)})`,
        pathActionSchema,
      );
      expect(!answer.ok, `Reveal handed the OS ${entry}, which is outside the vault`);
    }

    ctx.log("a switch to a remembered vault stops the child and boots one on the new vault");
    const before = shell.target();
    const beforeServer = requireServer(before);
    const [beforePage] = await shell.appPages();
    expect(beforePage !== undefined, "the shell has no window before the switch");
    // not awaited: a switch closes this window before its answer could land
    await browser([
      "eval",
      `void window.desktopBridge.vaults.open(${JSON.stringify(secondVault)}); "asked"`,
    ]);
    const secondVaultDir = physicalVaultDir(secondVault);
    const after = await pollUntil(
      async () => await switchedTo(shell),
      (state) =>
        state.target.vaultDir === secondVaultDir &&
        state.pages.length === 1 &&
        state.pages[0]?.id !== beforePage.id,
      {
        deadlineMs: SWITCH_DEADLINE_MS,
        describe: (state) =>
          `the switch never settled: the selector names ${state.target.vaultDir}, the pages are ${JSON.stringify(state.pages)}`,
      },
    );
    expect(after.target.dataDir !== before.dataDir, "the second vault shares the first's data dir");
    expect(
      readServerFile(before.dataDir) === null && !processAlive(beforeServer.pid),
      `the first vault's server (pid ${String(beforeServer.pid)}) outlived the switch`,
    );
    const afterServer = requireServer(after.target);
    expect(afterServer.pid !== beforeServer.pid, "the switch booted no new child");
    const { content } = await shell.api.vault.read({ path: SECOND_NOTE });
    expect(content.includes(SECOND_TOKEN), `the new child reads another vault:\n${content}`);

    ctx.log("the new window loads through the new session's protocol handler");
    // the session's page closed with the old window; the new one is the only page left to bind
    await browser(["connect", String(shell.cdpPort)], 60_000);
    await browser(["wait", treeRow(SECOND_NOTE)], RAIL_DEADLINE_MS);
    const state = await askBridge(
      browser,
      "window.desktopBridge.vaults.getState()",
      vaultsStateSchema,
    );
    expectEq(state.current.path, secondVaultDir, "the bridge's current vault");

    ctx.log("quit stops the server the shell started and retracts its server.json");
    await shell.quit();
    expect(
      readServerFile(after.target.dataDir) === null,
      `server.json outlived the quit in ${after.target.dataDir}`,
    );
    expect(
      !processAlive(afterServer.pid),
      `the server (pid ${String(afterServer.pid)}) outlived the shell`,
    );
  },
};
