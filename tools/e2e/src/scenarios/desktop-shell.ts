import { z } from "zod";
import { readServerFile } from "inteligir/server/server-file";
import { expect, expectEq } from "../harness/assert";
import { running } from "../harness/desktop-shell";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { SIDEBAR } from "../harness/selectors";

const ACTION_TITLE = "Shell action from the API";
const PAGE_DEADLINE_MS = 30_000;
const RAIL_DEADLINE_MS = 30_000;

export const desktopShell: Scenario = {
  description:
    "the built Tauri shell over WebDriver: its window signs in on the server's own origin and a first launch lands on /welcome, the socket reaches the rail, the pin and every permission refuse, and the server never outlives the shell",
  name: "desktop-shell",
  usesDesktopShell: true,
  async run(ctx) {
    const shell = await ctx.desktopShell({});
    const page = shell.window;

    ctx.log("the window is the server's own page, signed in by the handoff it was opened with");
    // the session opens with the window, and the page signs in after it
    await page.waitUntil("window.desktopBridge", PAGE_DEADLINE_MS);
    const url = await page.url();
    expect(url.startsWith(`${shell.serverOrigin}/`), `the window is not on the server: ${url}`);
    expect(!url.includes("handoff"), `the handoff's nonce stayed in the window's url: ${url}`);
    // a fresh home's data dir holds no thread log yet, so this is its first launch
    expectEq(new URL(url).pathname, "/welcome", "where a data dir's first launch lands");

    ctx.log(
      "an action made over the API reaches the rail: the cookie and the page's socket are live",
    );
    await page.waitUntil(`document.querySelector('${SIDEBAR}')`, PAGE_DEADLINE_MS);
    await shell.api.threads.create({ title: ACTION_TITLE });
    await pollUntil(
      async () => await page.textOf(SIDEBAR),
      (text) => text.includes(ACTION_TITLE),
      {
        deadlineMs: RAIL_DEADLINE_MS,
        describe: (text) => `the rail never listed the new action; it holds:\n${text}`,
      },
    );

    ctx.log("window.open is denied, the app's own origin included");
    // from a click: WebKit refuses an open no gesture made before the shell is asked, so a script's
    // own open would read as denied whatever the shell's policy says
    await page.run(
      `const button = document.createElement("button");
      button.id = "e2e-window-open";
      button.textContent = "open";
      button.style.cssText = "position:fixed;top:0;left:0;width:48px;height:48px;z-index:2147483647";
      button.addEventListener("click", () => {
        window.e2eOpened = String(window.open(${JSON.stringify(shell.serverOrigin)}));
      });
      document.body.append(button);
      return null;`,
      z.null(),
    );
    await page.clickWhenThere("#e2e-window-open", PAGE_DEADLINE_MS);
    const opened = await page.run("return window.e2eOpened ?? null", z.string().nullable());
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

    ctx.log("the server never outlives the shell: its teardown retracts server.json");
    const target = shell.target();
    const server = readServerFile(target.dataDir);
    expect(server !== null, `no server.json in ${target.dataDir}: the shell runs no server there`);
    await shell.quit();
    await pollUntil(
      async () =>
        await Promise.resolve(readServerFile(target.dataDir) === null && !running(server.pid)),
      (gone) => gone,
      {
        deadlineMs: 60_000,
        describe: () =>
          `the server (pid ${String(server.pid)}) or its server.json outlived the shell`,
      },
    );
  },
};
