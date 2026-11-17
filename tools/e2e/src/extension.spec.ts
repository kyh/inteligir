import path from "node:path";
import { chromium, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { EXTENSION_ORIGIN } from "@repo/contract/extension/extension-identity";
import { SIGN_IN_PATH } from "@repo/contract/library-page";
import { z } from "zod";
import { signInOnSite, test as base, watchErrors } from "./fixtures";
import type { Account, Cloud } from "./fixtures";

// WXT's output for the dev flavor, whose one cloud host is localhost and which may script a
// loopback page without a click, as activeTab lets a person's click do on any page
const BUILD = path.resolve(import.meta.dirname, "../../../apps/extension/.output/chrome-mv3");
const PAGES = "http://127.0.0.1";
// written by the page's own script once it loads, so it is in no markup a server sent
const PASSAGE = "Apps are ephemeral, and the files they write outlast every one of them.";

// what the extension's pages hear from its worker (apps/extension/src/messages.ts)
const OutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ created: z.boolean(), kind: z.literal("saved"), title: z.string() }),
  z.object({ kind: z.literal("queued"), waitsFor: z.enum(["connection", "sign-in"]) }),
  z.object({ kind: z.literal("refused"), reason: z.string() }),
]);
const StatusSchema = z.object({ account: z.object({ email: z.string() }).nullable() });
const QueuedSchema = z.array(z.looseObject({ email: z.string(), url: z.string() }));

const pageOf = (title: string, script = ""): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><article><h1>${title}</h1><p>If you want digital artifacts that last, they must be files you can control.</p><div id="later"></div><p>The file is the one thing every app agrees on.</p></article>${script}</body></html>`;

const PAGE_BODIES = new Map([
  [
    "/file-over-app",
    pageOf(
      "File over app",
      `<script>const p = document.createElement("p"); p.textContent = ${JSON.stringify(PASSAGE)}; document.getElementById("later").replaceWith(p);</script>`,
    ),
  ],
  ["/later", pageOf("Read it later")],
  ["/signed-out-elsewhere", pageOf("Signed out elsewhere")],
  ["/signed-out-here", pageOf("Signed out here")],
]);

const test = base.extend<{ extension: BrowserContext }>({
  extension: async ({ allowedErrors }, use) => {
    const context = await chromium.launchPersistentContext("", {
      args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
      channel: "chromium",
    });
    const seen = watchErrors(context, allowedErrors);
    await use(context);
    await context.close();
    expect(seen, "the extension's browser's page and console errors").toEqual([]);
  },
});

// a page of the site that asks the cloud nothing, so the extension alone meets a session's end
const QUIET_PAGE = "/privacy";

// signed in on the site, which is all the extension's sign-in is
const signIn = async (page: Page, cloud: Cloud, account: Account) => {
  await page.goto(`${cloud.origin}${SIGN_IN_PATH}?next=${QUIET_PAGE}`);
  await signInOnSite(page, account);
  await expect(page).toHaveURL(`${cloud.origin}${QUIET_PAGE}`);
};

test("the extension rides the browser's sign-in, saves the page as shown, and holds saves until they can land", async ({
  account,
  cloud,
  extension,
  library,
}) => {
  test.setTimeout(240_000);
  const served = new Map<string, number>();
  await extension.route(`${PAGES}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    served.set(pathname, (served.get(pathname) ?? 0) + 1);
    await route.fulfill({ body: PAGE_BODIES.get(pathname) ?? "", contentType: "text/html" });
  });
  const site = await extension.newPage();
  const panel = await extension.newPage();
  await panel.goto(`${EXTENSION_ORIGIN}/welcome.html`);
  // from an extension page, as the popup asks its worker; a string, since this program holds no
  // types for `chrome`
  const ask = async <T>(schema: z.ZodType<T>, source: string): Promise<T> =>
    schema.parse(await panel.evaluate(source));
  // the dev build's cloud is `pnpm dev:web`'s unless its storage names another local Worker, as
  // the one this run booted on a port of its own
  await panel.evaluate(
    `chrome.storage.local.set({ "cloud-origin": ${JSON.stringify(cloud.origin)} })`,
  );
  const signedInAs = async () => {
    const status = await ask(StatusSchema, `chrome.runtime.sendMessage({ type: "status" })`);
    return status.account?.email ?? null;
  };
  const queued = async () =>
    await ask(
      QueuedSchema,
      `chrome.storage.local.get(null).then((stored) =>
        Object.entries(stored).filter(([key]) => key.startsWith("save:")).map(([, save]) => save))`,
    );
  const save = async (pathname: string) => {
    const url = `${PAGES}${pathname}`;
    const tab = await extension.newPage();
    await tab.goto(url);
    return await ask(
      OutcomeSchema,
      `chrome.tabs.query({ url: ${JSON.stringify(url)} }).then(([tab]) =>
        chrome.runtime.sendMessage({ tabId: tab.id, type: "save" }))`,
    );
  };
  const landed = async (pathname: string) => {
    const { items } = await library.items.list({ kinds: ["link"] });
    return items.find((item) => item.url === `${PAGES}${pathname}`)?.id;
  };
  const alarms = async () => await ask(z.array(z.unknown()), `chrome.alarms.getAll()`);
  // a save the cloud left unanswered is sent by the extension's alarm, 30 s on
  const byAlarm = { timeout: 90_000 };
  // one that waited for its account is sent as the site signs it in, well inside the alarm's 30 s
  const bySignIn = { timeout: 10_000 };

  expect(await signedInAs()).toBeNull();
  await signIn(site, cloud, account);
  expect(await signedInAs()).toBe(account.email);
  expect(await save("/file-over-app")).toEqual({
    created: true,
    kind: "saved",
    title: "File over app",
  });
  const read = await library.items.read({ id: (await landed("/file-over-app")) ?? "" });
  expect(read.fields).toMatchObject({ reading: { state: "read" } });
  expect(read.view.markdown).toContain(PASSAGE);
  // the browser's one load: the extension fetched it no second time, and a fetch of it by the
  // cloud fails the test as one no page answered
  expect(served.get("/file-over-app")).toBe(1);
  expect(await save("/file-over-app")).toEqual({
    created: false,
    kind: "saved",
    title: "File over app",
  });

  const cut = `${cloud.origin}/**`;
  await extension.route(cut, async (route) => {
    await route.abort();
  });
  expect(await save("/later")).toEqual({ kind: "queued", waitsFor: "connection" });
  expect(await queued()).toMatchObject([{ url: `${PAGES}/later` }]);
  await extension.unroute(cut);
  await expect.poll(queued, byAlarm).toEqual([]);
  expect(await landed("/later")).toBeDefined();

  const { devices } = await account.client.devices.list();
  for (const device of devices.filter(({ current }) => !current)) {
    await account.client.devices.revoke({ id: device.id });
  }
  expect(await save("/signed-out-elsewhere")).toEqual({ kind: "queued", waitsFor: "sign-in" });
  expect(await queued()).toMatchObject([
    { email: account.email, url: `${PAGES}/signed-out-elsewhere` },
  ]);
  expect(await signedInAs()).toBeNull();
  await signIn(site, cloud, account);
  await expect.poll(queued, bySignIn).toEqual([]);
  expect(await landed("/signed-out-elsewhere")).toBeDefined();

  const signedOut = await site.evaluate(async () => {
    const response = await fetch("/api/auth/sign-out", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.status;
  });
  expect(signedOut).toBe(200);
  expect(await signedInAs()).toBeNull();
  expect(await save("/signed-out-here")).toEqual({ kind: "queued", waitsFor: "sign-in" });
  // it waits on a person, so no alarm wakes the worker for it
  expect(await alarms()).toEqual([]);
  await signIn(site, cloud, account);
  await expect.poll(queued, bySignIn).toEqual([]);
  expect(await landed("/signed-out-here")).toBeDefined();
  expect(await signedInAs()).toBe(account.email);

  // the toolbar's popup, opened as a tab of its own: the tab it saves is itself, which is no web
  // page, and it says so beside who is signed in
  const popup = await extension.newPage();
  await popup.goto(`${EXTENSION_ORIGIN}/popup.html`);
  await expect(popup.getByRole("alert")).toHaveText("Inteligir can't save this kind of page");
  await expect(popup.getByText(`Signed in as ${account.email}`)).toBeVisible();
});
