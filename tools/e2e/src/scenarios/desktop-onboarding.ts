// The Mac app's first run against a booted Worker: a fresh home opens on the window's sign-in and
// keeps nothing of an account; signing in keeps the device's credential and opens the library from
// the shell's own replica, a SQLite file in the app's data dir holding what the account holds; a
// relaunch goes straight to the library; Sign out leaves nothing of the account on the Mac; and the
// next sign-in opens on the library, not on the Settings the sign-out was pressed from.

import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { replicaTitle, SHELL_PAGE_URL, signInThroughWindow } from "../harness/desktop-shell";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { libraryCard } from "../harness/selectors";
import { v1Client } from "../harness/v1-wire";

const TITLE = "Notes from the first run";
const DEADLINE_MS = 60_000;
// Settings › Account's own Sign out, not a device row's (each named for its device)
const MARK_SIGN_OUT = `const button = [...document.querySelectorAll("#account button")].find(
  (candidate) => candidate.textContent.trim() === "Sign out" && !candidate.hasAttribute("aria-label"),
);
button?.setAttribute("data-e2e-sign-out", "");
return button !== undefined;`;

export const desktopOnboarding: Scenario = {
  description:
    "the built shell on a fresh home opens its one window on the page it carries, at the sign-in, holding no replica; signing in as the account keeps its credential and draws the account's item from the shell's own replica file; a relaunch opens the library with no sign-in; Sign out removes the replica's file and opens the sign-in again; the next sign-in opens the library, not the Settings it left from",
  name: "desktop-onboarding",
  // the shell launches twice, beside a booted Worker
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS + 180_000,
  exclusive: ["desktop-shell"],
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);
    const device = await v1Client(worker, null).account.signIn({
      ...OWNER,
      deviceName: "E2E Seeder",
    });
    const { account, library } = v1Client(worker, device.credential);
    const { item } = await library.items.createNote({
      markdown: "Kept on every device.\n",
      title: TITLE,
    });

    const shell = await ctx.desktopShell({ cloudOrigin: worker.origin });
    const page = shell.window;

    ctx.log("a fresh home opens on the page the shell carries, at its sign-in, holding nothing");
    await page.waitForText("Sign in to your library", DEADLINE_MS);
    const url = await page.url();
    expect(url.startsWith(SHELL_PAGE_URL), `the window is not on the shell's page: ${url}`);
    expectEq(shell.replicaFiles(), [], "the replica files before any sign-in");

    ctx.log("signing in opens the library from the shell's own replica");
    await signInThroughWindow(page, OWNER);
    await page.waitUntil(
      `document.querySelector(${JSON.stringify(libraryCard(item.id))}) !== null`,
      DEADLINE_MS,
    );
    const [file] = shell.replicaFiles();
    expect(file !== undefined, "signing in kept no replica file");
    expectEq(replicaTitle(file, item.id), TITLE, "the item's title in the shell's replica");
    const devices = await account.devices.list();
    expect(
      devices.devices.filter((held) => held.revokedAt === null).length === 2,
      `the Mac's sign-in minted no credential of its own: ${JSON.stringify(devices.devices)}`,
    );

    ctx.log("a relaunch goes straight to the library, its credential kept");
    await shell.quit();
    const again = await ctx.desktopShell({ cloudOrigin: worker.origin });
    await again.window.waitUntil(
      `document.querySelector(${JSON.stringify(libraryCard(item.id))}) !== null`,
      DEADLINE_MS,
    );

    ctx.log("Sign out leaves nothing of the account, and opens the sign-in again");
    await again.window.run(`window.location.hash = "#/settings"; return null;`, z.null());
    await pollUntil(
      async () => await again.window.run(MARK_SIGN_OUT, z.boolean()),
      (marked) => marked,
      { deadlineMs: DEADLINE_MS, describe: () => "Settings drew no Sign out" },
    );
    await again.window.click("[data-e2e-sign-out]");
    await again.window.waitForText("Sign in to your library", DEADLINE_MS);
    await pollUntil(
      async () => await Promise.resolve(again.replicaFiles()),
      (files) => files.length === 0,
      {
        deadlineMs: DEADLINE_MS,
        describe: (files) => `the replica outlived the sign-out: ${files.join(", ")}`,
      },
    );
    const after = await account.devices.list();
    expect(
      after.devices.filter((held) => held.revokedAt === null).length === 1,
      "the sign-out left the Mac's credential live",
    );

    ctx.log("the next sign-in opens the library, not the Settings the sign-out left from");
    await signInThroughWindow(again.window, OWNER);
    // Settings covers a grid that stays mounted, so a card alone would pass on it
    await again.window.waitUntil(
      `document.querySelector(${JSON.stringify(libraryCard(item.id))}) !== null && document.querySelector("#account") === null`,
      DEADLINE_MS,
    );
    await again.quit();
  },
};
