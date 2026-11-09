// Settings in the tab, over the account's cell and the Worker: what only the cloud answers waits
// for a connection and says so, then fills in once the tab is back online; the devices list marks
// this tab's own session, and another session signed out from it can no longer reach the library;
// the built-in agent's switch is the account's; a Raindrop export imports; Delete account… holds
// its button until a password is typed and says the cloud's refusal; and Sign out ends this tab's
// session alone and leaves for the site's sign-in, the library's page sending the tab back there
// after.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  clickButtonIn,
  modChord,
  parseEval,
  press,
  untilBodyHolds,
} from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { OWNER, signInPhone } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { TOAST_TEXT } from "../harness/selectors";
import { asPhone, v1Client } from "../harness/v1-wire";
import { isOrpcError } from "@repo/contract/v1/errors";

// what the cloud names a session the phone's runtime signed in, from the system's networking stack
// its native requests carry
const PHONE = "iPhone";
// Better Auth's session cookie on the local Worker's http origin, which takes no `__Secure-` prefix
const SESSION_COOKIE = "better-auth.session_token";
const DEADLINE_MS = 30_000;
const IMPORT_DEADLINE_MS = 60_000;
const NEEDS_CONNECTION = "[data-needs-connection]";
// a host no page answers (TEST-NET-1), so the imported link's reading fails without leaving the
// machine; the import itself fetches nothing
const RAINDROP = `id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite
1,Pasta al limone,,A quick lemon pasta.,http://192.0.2.10/pasta,Cooking,recipes,1696147200,,,false
`;
const PASTA = "Pasta al limone";
const DELETE_DIALOG = '[role="dialog"]:has(input[type="password"])';
// the cloud's own sentence, written out: any failure it did not declare toasts the screen's
// fallback, so a toast alone proves no refusal
const WRONG_PASSWORD_REFUSAL = "That email and password don't match an account.";
const DELETE_STATE = `(() => {
  const button = [...document.querySelectorAll(${JSON.stringify(`${DELETE_DIALOG} button`)})].find((el) => el.textContent.trim() === "Delete everything");
  if (!button) return "missing";
  return button.disabled ? "disabled" : "enabled";
})()`;
// for each row the devices list marks as this tab's own, whether it offers a Sign out
const OWN_ROWS = `JSON.stringify([...document.querySelectorAll('ul[aria-label="Devices"] li')]
  .filter((row) => row.textContent.includes("This device"))
  .map((row) => row.querySelector("button") !== null))`;

// how a call answered: the code it was refused with, or that it answered
const outcomeOf = async (call: () => Promise<object>): Promise<string> => {
  try {
    await call();
    return "answered";
  } catch (error) {
    return isOrpcError(error) ? error.code : "failed";
  }
};

export const settingsBrowser: Scenario = {
  description:
    "Settings in the tab: opened offline, every row the cloud answers says it needs a connection and fills in once the tab is back online; the devices list marks this tab's own session with no Sign out, and a phone's session signed out from it is refused after; the built-in agent's switch turns it off for the account; a Raindrop export imports; Delete account… holds its button until a password is typed and shows the cloud's refusal; Sign out ends this tab's session alone and leaves for the site's sign-in, and the library's page sends the tab there after",
  name: "settings-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const { browser, library, worker } = await openLibraryTab(ctx, "settings");
    const phone = v1Client(worker, asPhone(await signInPhone(worker.origin)));

    ctx.log("Settings opened offline: each row the cloud answers waits, and says so");
    await browser(["set", "offline", "on"]);
    await browser(["press", modChord(",")]);
    await untilBodyHolds(browser, ["Signed in as", OWNER.email]);
    await pollUntil(
      async () => await browser(["get", "count", NEEDS_CONNECTION]),
      (count) => Number(count.trim()) >= 3,
      {
        deadlineMs: DEADLINE_MS,
        describe: (count) => `${count.trim()} rows said they need a connection, not every one`,
      },
    );

    ctx.log("back online, the rows fill in: the devices, no assistants, the agent's switch");
    await browser(["set", "offline", "off"]);
    await untilBodyHolds(browser, [PHONE, "None. Claude or ChatGPT", "turns left today"]);
    const waiting = await browser(["get", "count", NEEDS_CONNECTION]);
    expectEq(waiting.trim(), "0", "rows still waiting once online");
    expectEq(
      parseEval(await browser(["eval", OWN_ROWS]), z.array(z.boolean())),
      [false],
      "the tab's own rows and whether each offers a Sign out",
    );

    ctx.log("the phone's session signed out from the list is refused after");
    expectEq(
      await outcomeOf(async () => await phone.library.agent.status()),
      "answered",
      "the phone before it was signed out",
    );
    await browser(["click", `button[aria-label="Sign out ${PHONE}"]`]);
    await pollUntil(
      async () => await outcomeOf(async () => await phone.library.agent.status()),
      (outcome) => outcome === "UNAUTHORIZED",
      { deadlineMs: DEADLINE_MS, describe: (outcome) => `the signed-out phone was ${outcome}` },
    );

    ctx.log("the agent's switch turns it off for the account");
    await browser([
      "wait",
      "--fn",
      `document.querySelector(${JSON.stringify(`button[aria-label="Sign out ${PHONE}"]`)}) === null`,
    ]);
    await press(browser, '[role="switch"][aria-label="Built-in agent"]');
    await pollUntil(
      async () => await library.agent.status(),
      (status) => !status.enabled,
      { deadlineMs: DEADLINE_MS, describe: () => "the built-in agent stayed on" },
    );
    await untilBodyHolds(browser, ["Off: it answers nothing"]);

    ctx.log("a Raindrop export imports into the library");
    const csv = path.join(ctx.scratchDir, "raindrop.csv");
    await writeFile(csv, RAINDROP, "utf-8");
    await browser(["upload", 'input[aria-label="The file to import"]', csv]);
    await browser(["wait", '[data-import-state="done"]'], IMPORT_DEADLINE_MS);
    await pollUntil(
      async () => await library.items.list({}),
      (listed) => listed.items.some((item) => item.title === PASTA),
      { deadlineMs: DEADLINE_MS, describe: () => `the cell never held "${PASTA}"` },
    );

    ctx.log("Delete account… holds its button until a password is typed, and says the refusal");
    await clickButtonIn(browser, "#account", "Delete account…");
    await browser(["wait", DELETE_DIALOG], DEADLINE_MS);
    expectEq(
      parseEval(await browser(["eval", DELETE_STATE]), z.string()),
      "disabled",
      "the delete button before a password",
    );
    await browser(["fill", `${DELETE_DIALOG} input[type="password"]`, "not the password"]);
    await clickButtonIn(browser, DELETE_DIALOG, "Delete everything");
    await pollUntil(
      async () => parseEval(await browser(["eval", TOAST_TEXT]), z.string()),
      (text) => text.includes(WRONG_PASSWORD_REFUSAL),
      {
        deadlineMs: DEADLINE_MS,
        describe: (text) => `the refused deletion never said the refusal; its toasts say:\n${text}`,
      },
    );
    const still = await library.agent.status();
    expect(!still.enabled, "the account answered nothing after a refused deletion");
    await browser(["press", "Escape"]);
    // closed, and its backdrop gone with it: the exit animation still covers the page
    await browser([
      "wait",
      "--fn",
      `document.querySelector(${JSON.stringify(DELETE_DIALOG)}) === null`,
    ]);

    ctx.log("Sign out ends this tab's session alone, its cookie with it, and leaves for sign-in");
    const signedInJar = await browser(["cookies"]);
    expect(signedInJar.includes(SESSION_COOKIE), "the tab held no session cookie to sign out");
    await browser(["find", "role", "button", "click", "--name", "Sign out", "--exact"]);
    await pollUntil(
      async () => await browser(["get", "url"]),
      (url) => url.includes("/app/sign-in"),
      {
        deadlineMs: DEADLINE_MS,
        describe: (url) => `the signed-out tab stayed on ${url}`,
      },
    );
    const signedOutJar = await browser(["cookies"]);
    expect(!signedOutJar.includes(SESSION_COOKIE), "the signed-out tab still holds its cookie");
    expectEq(
      await outcomeOf(async () => await library.agent.status()),
      "answered",
      "the account's other device after this tab signed out",
    );
    await browser(["open", `${worker.origin}/library`], 60_000);
    await pollUntil(
      async () => await browser(["get", "url"]),
      (url) => url.includes("/app/sign-in"),
      {
        deadlineMs: DEADLINE_MS,
        describe: (url) => `the library opened for a signed-out tab at ${url}`,
      },
    );
  },
};
