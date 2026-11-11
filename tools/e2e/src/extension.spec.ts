import path from "node:path";
import { chromium, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { CONNECT_EXTENSION_PATH } from "@repo/contract/extension/extension-connect";
import { EXTENSION_ORIGIN } from "@repo/contract/extension/extension-identity";
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

// signed in on the site, which comes back to the connect page, and Connect pressed when asked
const connect = async (page: Page, cloud: Cloud, account: Account, press: boolean) => {
  await page.goto(`${cloud.origin}${CONNECT_EXTENSION_PATH}`);
  await signInOnSite(page, account);
  await expect(page.getByRole("heading", { name: "Connect the browser extension" })).toBeVisible();
  if (press) {
    await page.getByRole("main").getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText("Connected.")).toBeVisible();
  }
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
    const { items } = await library.items.list({ kind: "link" });
    return items.find((item) => item.url === `${PAGES}${pathname}`)?.id;
  };
  // the extension's alarm sends what waits every 30 s
  const sent = { timeout: 90_000 };

  await connect(site, cloud, account, true);
  expect(await signedInAs()).toBe(account.email);
  expect(await save("/file-over-app")).toEqual({
    created: true,
    kind: "saved",
    title: "File over app",
  });
  const read = await library.items.read({ id: (await landed("/file-over-app")) ?? "" });
  expect(read.fields).toMatchObject({ fetchError: null, fetchState: "filled" });
  expect(read.view.markdown).toContain(PASSAGE);
  // the browser's one load: neither the extension nor the cloud fetched it again
  expect(served.get("/file-over-app")).toBe(1);
  expect(cloud.fetched).toEqual([]);
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
  await expect.poll(queued, sent).toEqual([]);
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
  await connect(site, cloud, account, true);
  await expect.poll(queued, sent).toEqual([]);
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
  // signed in again on the site, with no Connect asked
  await connect(site, cloud, account, false);
  await expect.poll(queued, sent).toEqual([]);
  expect(await landed("/signed-out-here")).toBeDefined();
  expect(await signedInAs()).toBe(account.email);
});
