import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { physicalVaultDir } from "inteligir/server/config";
import { readServerFile } from "inteligir/server/server-file";
import { processAlive } from "inteligir/server/server-probe";
import { expect, expectEq } from "../harness/assert";
import { running, WINDOW_LOADED } from "../harness/desktop-shell";
import type { DesktopShell, ShellTarget } from "../harness/desktop-shell";
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
// the shell's own list (apps/desktop/src-tauri/src/vaults.rs): the page may only open a vault it holds
const RECENT_VAULTS_FILE = "recent-vaults.json";
const RAIL_DEADLINE_MS = 60_000;
const PAGE_DEADLINE_MS = 30_000;
const EDITOR_DEADLINE_MS = 30_000;
const SWITCH_DEADLINE_MS = 90_000;

const pathActionSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

const requireServer = (target: ShellTarget) => {
  const server = readServerFile(target.dataDir);
  expect(server !== null, `no server.json in ${target.dataDir}: the shell runs no server there`);
  return server;
};

interface SwitchState {
  target: ShellTarget;
  serving: boolean;
  loaded: boolean;
}

const switchedTo = async (shell: DesktopShell): Promise<SwitchState> => {
  const target = shell.target();
  const log = await shell.serverLog(target);
  return {
    loaded: log.some((line) => line.includes(WINDOW_LOADED)),
    serving: readServerFile(target.dataDir) !== null,
    target,
  };
};

export const desktopShell: Scenario = {
  description:
    "the built Tauri shell over WebDriver: its window signs in on the server's own origin, the socket reaches the editor, the pin, every permission and Reveal refuse, a vault switch boots a new child and a new window, and the server never outlives the shell",
  name: "desktop-shell",
  // the shell boots twice (the switch)
  timeoutMs: 300_000,
  usesDesktopShell: true,
  async run(ctx) {
    const outsideFile = path.join(ctx.scratchDir, "outside", "secret.md");
    await mkdir(path.dirname(outsideFile), { recursive: true });
    await writeFile(outsideFile, "# Secret\n", "utf-8");
    const secondVault = path.join(ctx.scratchDir, "second-vault");
    await mkdir(secondVault, { recursive: true });
    await writeFile(path.join(secondVault, SECOND_NOTE), `# Elsewhere\n\n${SECOND_TOKEN}\n`);

    const shell = await ctx.desktopShell({
      seedOwnDir: async (ownDir) => {
        await writeFile(
          path.join(ownDir, RECENT_VAULTS_FILE),
          JSON.stringify({ vaults: [{ path: secondVault }] }),
        );
      },
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, NOTE), `# Shell\n\n${SEEDED_TOKEN}\n`, "utf-8");
        await symlink(outsideFile, path.join(vaultDir, ESCAPE_LINK));
      },
    });
    const page = shell.window;

    ctx.log("the window is the server's own page, signed in by the handoff it was opened with");
    // the session opens with the window, and the page signs in after it
    await page.waitUntil("window.desktopBridge", PAGE_DEADLINE_MS);
    const url = await page.url();
    expect(url.startsWith(`${shell.serverOrigin}/`), `the window is not on the server: ${url}`);
    expect(!url.includes("handoff"), `the handoff's nonce stayed in the window's url: ${url}`);

    ctx.log("the rail lists the seeded note, and the note opens: the cookie carries every call");
    await page.clickWhenThere(treeRow(NOTE), RAIL_DEADLINE_MS);
    const readEditor = async (): Promise<string> => await page.textOf(EDITOR);
    await pollUntil(readEditor, (text) => text.includes(SEEDED_TOKEN), {
      deadlineMs: EDITOR_DEADLINE_MS,
      describe: (text) => `the editor never opened ${NOTE}; it holds:\n${text}`,
    });

    ctx.log("a write over the API reaches the open editor: the page's socket is live");
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
    const opened = await page.run(
      `return String(window.open(${JSON.stringify(shell.serverOrigin)}))`,
      z.string(),
    );
    expectEq(opened, "null", "window.open's answer");
    const handles = await page.handles();
    expectEq(handles.length, 1, "windows after window.open");

    ctx.log("the window holds no permission: every request is denied");
    // dictation is the OS's, so the page needs no microphone; a runner has no capture device to
    // ask for, so the requests it can make stand for it
    const location = await page.runAsync(
      "navigator.geolocation.getCurrentPosition(() => done('granted'), (error) => done(String(error.code)))",
      z.string(),
    );
    expectEq(location, "1", "the location request's answer (1 is PERMISSION_DENIED)");
    const notifications = await page.runAsync(
      "Notification.requestPermission().then(done, (error) => done(String(error)))",
      z.string(),
    );
    expectEq(notifications, "denied", "the notification request's answer");

    ctx.log("Reveal refuses what the vault does not physically contain");
    for (const entry of [ESCAPE_LINK, "../outside/secret.md"]) {
      const answer = await page.runAsync(
        `window.desktopBridge.paths.reveal(${JSON.stringify(entry)}).then(done, (error) => done({ ok: false, reason: String(error) }))`,
        pathActionSchema,
      );
      expect(!answer.ok, `Reveal handed the OS ${entry}, which is outside the vault`);
    }

    ctx.log("a switch to a remembered vault stops the child and boots one on the new vault");
    const before = shell.target();
    const beforeServer = requireServer(before);
    // not awaited: a switch closes this window before its answer could land
    await page.run(
      `void window.desktopBridge.vaults.open(${JSON.stringify(secondVault)}); return "asked"`,
      z.string(),
    );
    const secondVaultDir = physicalVaultDir(secondVault);
    const after = await pollUntil(
      async () => await switchedTo(shell),
      (state) => state.target.vaultDir === secondVaultDir && state.serving && state.loaded,
      {
        deadlineMs: SWITCH_DEADLINE_MS,
        describe: (state) =>
          `the switch never settled: the selector names ${state.target.vaultDir}, serving ${String(state.serving)}, a window loaded ${String(state.loaded)}`,
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
    // the session's window was the first vault's, and the switch closed it
    expectEq(await page.handles(), [], "the first vault's window after the switch");

    ctx.log("the server never outlives the shell: its teardown retracts server.json");
    await shell.quit();
    await pollUntil(
      async () =>
        await Promise.resolve(
          readServerFile(after.target.dataDir) === null && !running(afterServer.pid),
        ),
      (gone) => gone,
      {
        deadlineMs: 60_000,
        describe: () =>
          `the server (pid ${String(afterServer.pid)}) or its server.json outlived the shell`,
      },
    );
  },
};
