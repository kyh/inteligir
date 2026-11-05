import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import {
  backToLibrary,
  replicaTitle,
  SHELL_PAGE_URL,
  signInThroughWindow,
} from "../harness/desktop-shell";
import type { DesktopShell } from "../harness/desktop-shell";
import { untilItemText } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, doubleClickCard, libraryCard } from "../harness/selectors";
import { uploadFile, v1Client } from "../harness/v1-wire";
import { farJumpsHold, seedLongArticle } from "./desktop-shell/long-note";
import { seedViewerItems, viewersDraw } from "./desktop-shell/viewers";

const TITLE = "Shell note";
const SEEDED = "Seeded on another device.";
const WRITTEN = "Written by another device while this one reads.";
const OFFLINE = " Typed with no connection.";
const PAGE_DEADLINE_MS = 60_000;
const EDITOR_DEADLINE_MS = 30_000;
// past the editor's pause before it writes what was typed into the outbox
const PAST_THE_PAUSE_MS = 2000;

const editorText = async (shell: DesktopShell): Promise<string> =>
  await shell.window.textOf(EDITOR);

const untilEditorHolds = async (
  shell: DesktopShell,
  words: string,
  what: string,
): Promise<void> => {
  await pollUntil(
    async () => await editorText(shell),
    (text) => text.includes(words),
    { deadlineMs: EDITOR_DEADLINE_MS, describe: (text) => `${what}; the editor holds:\n${text}` },
  );
};

const openItem = async (shell: DesktopShell, itemId: string): Promise<void> => {
  await shell.window.waitUntil(
    `document.querySelector(${JSON.stringify(libraryCard(itemId))}) !== null`,
    PAGE_DEADLINE_MS,
  );
  expectEq(
    await shell.window.run(`return ${doubleClickCard(itemId)};`, z.string()),
    "opened",
    TITLE,
  );
  await shell.window.waitUntil(
    `document.querySelector(${JSON.stringify(EDITOR)}) !== null`,
    PAGE_DEADLINE_MS,
  );
};

export const desktopShell: Scenario = {
  description:
    "the built Tauri shell over WebDriver against a booted Worker: the window is the page the shell carries, signed in on its own sign-in; the library reads the shell's own replica, and a write another device makes reaches the open editor through the socket; `window.open` is denied and every permission request refused; a picture and a PDF draw over the shell's file scheme, fetched with the credential; in WebKit, a far jump in a long article lands on its target and holds still and scrolling back up never leaps; with the cloud cut, a relaunch opens the library and the item from the replica, an edit queues, and once the cloud is back the edit lands in the cell",
  name: "desktop-shell",
  // the shell launches twice beside a booted Worker, and the far jumps and viewers take their time
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS + 300_000,
  exclusive: ["desktop-shell"],
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);
    const device = await v1Client(worker, null).account.signIn({
      ...OWNER,
      deviceName: "E2E Seeder",
    });
    const { library } = v1Client(worker, device.credential);
    const { item } = await library.items.createNote({ markdown: `${SEEDED}\n`, title: TITLE });
    const article = await seedLongArticle(library);
    const viewers = await seedViewerItems(library, async (file) => {
      const uploaded = await uploadFile(worker, device.credential, file);
      expectEq(uploaded.status, 201, "the seed's upload");
      return uploaded.sha;
    });
    const link = await ctx.cloudLink(worker);

    const shell = await ctx.desktopShell({ cloudOrigin: link.origin });
    const page = shell.window;

    ctx.log("the window is the page the shell carries, and its first run is the sign-in");
    await signInThroughWindow(page, OWNER);
    const url = await page.url();
    expect(url.startsWith(SHELL_PAGE_URL), `the window is not on the shell's page: ${url}`);

    ctx.log("the library reads the shell's replica, and the card opens the item");
    await openItem(shell, item.id);
    await untilEditorHolds(shell, SEEDED, "the item never opened");
    const [file] = shell.replicaFiles();
    expect(file !== undefined, "the shell holds no replica file");
    expectEq(replicaTitle(file, item.id), TITLE, "the item in the shell's replica");

    ctx.log("a write another device makes reaches the open editor: the socket is live");
    const read = await library.items.read({ id: item.id });
    await library.items.edit({
      baseSeq: read.seq,
      edits: [{ newText: `${SEEDED} ${WRITTEN}`, oldText: SEEDED }],
      id: item.id,
    });
    await untilEditorHolds(shell, WRITTEN, "the editor never heard the other device's write");

    ctx.log("window.open is denied, the app's own origin included");
    // from a click: WebKit refuses an open no gesture made before the shell is asked, so a script's
    // own open would read as denied whatever the shell's policy says
    await page.run(
      `const button = document.createElement("button");
      button.id = "e2e-window-open";
      button.textContent = "open";
      button.style.cssText = "position:fixed;top:0;left:0;width:48px;height:48px;z-index:2147483647";
      button.addEventListener("click", () => {
        window.e2eOpened = String(window.open(location.href));
      });
      document.body.append(button);
      return null;`,
      z.null(),
    );
    await page.clickWhenThere("#e2e-window-open", PAGE_DEADLINE_MS);
    expectEq(
      await page.run("return window.e2eOpened ?? null", z.string().nullable()),
      "null",
      "window.open's answer",
    );
    const handles = await page.handles();
    expectEq(handles.length, 1, "windows after window.open");
    await page.run(`document.getElementById("e2e-window-open")?.remove(); return null;`, z.null());

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

    await backToLibrary(page);
    await viewersDraw(ctx, page, viewers);

    ctx.log("a long article: the find bar's far jumps hold, and the scroll back up never leaps");
    await farJumpsHold(ctx, page, article);
    await backToLibrary(page);

    ctx.log("with the cloud cut, a relaunch opens the library and the item from the replica");
    await shell.quit();
    await link.cut();
    const offline = await ctx.desktopShell({ cloudOrigin: link.origin });
    await openItem(offline, item.id);
    await untilEditorHolds(offline, WRITTEN, "the relaunch read no item offline");

    ctx.log("an edit made offline queues, and lands in the cell once the cloud is back");
    await offline.window.run(
      `const editor = document.querySelector(${JSON.stringify(EDITOR)});
      const range = document.createRange();
      range.selectNodeContents(editor.lastElementChild);
      range.collapse(false);
      editor.focus();
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return null;`,
      z.null(),
    );
    await offline.window.typeInto(EDITOR, OFFLINE);
    await untilEditorHolds(offline, OFFLINE.trim(), "the offline edit never showed");
    await delay(PAST_THE_PAUSE_MS);
    const unsent = await library.items.read({ id: item.id });
    expect(
      !unsent.view.markdown.includes(OFFLINE.trim()),
      "the edit reached the cell with the cloud cut",
    );
    await link.restore();
    await untilItemText(
      library,
      item.id,
      (markdown) => markdown.includes(OFFLINE.trim()),
      "the queued edit never landed once the cloud was back",
    );
    await offline.quit();
  },
};
