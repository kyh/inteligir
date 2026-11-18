import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { EXTENSION_ORIGIN } from "@repo/contract/extension/extension-identity";
import { SIGN_IN_PATH } from "@repo/contract/library-page";
import { z } from "zod";
import { download, newId, signInOnSite, test as base, watchErrors } from "./app.fixture";
import type { Account, Cloud } from "./app.fixture";

const BUILD = path.resolve(import.meta.dirname, "../../../apps/extension/.output/chrome-mv3");
const PAGES = "http://127.0.0.1";
const PASSAGE = "Apps are ephemeral, and the files they write outlast every one of them.";

const OutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ created: z.boolean(), kind: z.literal("saved"), title: z.string() }),
  z.object({ kind: z.literal("queued"), waitsFor: z.enum(["connection", "sign-in"]) }),
  z.object({ kind: z.literal("refused"), reason: z.string() }),
]);

const StatusSchema = z.object({ account: z.object({ email: z.string() }).nullable() });

const QueuedSchema = z.array(
  z.looseObject({ payload: z.looseObject({ email: z.string(), url: z.string() }) }),
);

const pageOf = (title: string, script = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><article><h1>${title}</h1><p>If you want digital artifacts that last, they must be files you can control.</p><div id="later"></div><p>The file is the one thing every app agrees on.</p></article>${script}</body></html>`;

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

const QUIET_PAGE = "/privacy";

const signIn = async (page: Page, cloud: Cloud, account: Account) => {
  await page.goto(`${cloud.origin}${SIGN_IN_PATH}?next=${QUIET_PAGE}`);
  await signInOnSite(page, account);
  await expect(page).toHaveURL(`${cloud.origin}${QUIET_PAGE}`);
};

const openPanel = async (extension: BrowserContext, cloud: Cloud) => {
  const panel = await extension.newPage();
  await panel.goto(`${EXTENSION_ORIGIN}/welcome.html`);

  const ask = async <T>(schema: z.ZodType<T>, source: string) =>
    schema.parse(await panel.evaluate(source));

  await panel.evaluate(
    `chrome.storage.local.set({ "cloud-origin": ${JSON.stringify(cloud.origin)} })`,
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

  return { ask, panel, save };
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
  const { ask, panel, save } = await openPanel(extension, cloud);

  const signedInAs = async () => {
    const status = await ask(StatusSchema, `chrome.runtime.sendMessage({ type: "status" })`);

    return status.account?.email ?? null;
  };

  const queued = async () =>
    await ask(
      QueuedSchema,
      `chrome.storage.local.get(null).then((stored) =>
        Object.entries(stored).filter(([key]) => key.startsWith("save:")).map(([, save]) => JSON.parse(save)))`,
    );

  const landed = async (pathname: string) => {
    const { items } = await library.items.list({ kinds: ["link"] });

    return items.find((item) => item.url === `${PAGES}${pathname}`)?.id;
  };

  const alarms = async () => await ask(z.array(z.unknown()), `chrome.alarms.getAll()`);
  const byAlarm = { timeout: 90_000 };
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
  expect(await queued()).toMatchObject([{ payload: { url: `${PAGES}/later` } }]);
  await extension.unroute(cut);
  await expect.poll(queued, byAlarm).toEqual([]);
  expect(await landed("/later")).toBeDefined();

  const { devices } = await account.client.devices.list();

  for (const device of devices.filter(({ current }) => !current)) {
    await account.client.devices.revoke({ id: device.id });
  }

  expect(await save("/signed-out-elsewhere")).toEqual({ kind: "queued", waitsFor: "sign-in" });
  expect(await queued()).toMatchObject([
    { payload: { email: account.email, url: `${PAGES}/signed-out-elsewhere` } },
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
  expect(await alarms()).toEqual([]);
  await signIn(site, cloud, account);
  await expect.poll(queued, bySignIn).toEqual([]);
  expect(await landed("/signed-out-here")).toBeDefined();
  expect(await signedInAs()).toBe(account.email);

  const popup = await extension.newPage();
  await popup.goto(`${EXTENSION_ORIGIN}/popup.html`);
  await expect(popup.getByRole("alert")).toHaveText("Inteligir can't save this kind of page");
  await expect(popup.getByText(`Signed in as ${account.email}`)).toBeVisible();

  const refusedAt = (pathname: string) => {
    const opId = newId();

    return {
      [`save:${opId}`]: JSON.stringify({
        id: newId(),
        opId,
        payload: { email: account.email, title: "", url: `${PAGES}${pathname}` },
        refused: "Your library is full.",
        savedAt: Date.now(),
      }),
    };
  };

  await panel.evaluate(
    `chrome.storage.local.set(${JSON.stringify({ ...refusedAt("/tried-again"), ...refusedAt("/let-go") })})`,
  );
  await popup.reload();
  const refused = popup.getByRole("listitem");
  await expect(refused).toHaveCount(2);
  const triedAgain = refused.filter({ hasText: `${PAGES}/tried-again` });
  await expect(triedAgain).toContainText("Your library is full.");
  await triedAgain.getByRole("button", { name: "Try again" }).click();
  await expect(refused).toHaveCount(1);
  expect(await landed("/tried-again")).toBeDefined();
  await refused.getByRole("button", { name: "Let it go" }).click();
  await expect(refused).toHaveCount(0);
  expect(await queued()).toEqual([]);
  expect(await landed("/let-go")).toBeUndefined();
});

const LARGE_COVER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from("IHDR"),
  Buffer.from([0, 0, 0x06, 0x40, 0, 0, 0x03, 0x84]),
  randomBytes(5 * 1024 * 1024),
]);

test("the extension keeps a page's cover larger than one request carries", async ({
  account,
  cloud,
  extension,
  library,
}) => {
  await extension.route(`${PAGES}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    await (pathname === "/cover.png"
      ? route.fulfill({ body: LARGE_COVER, contentType: "image/png" })
      : route.fulfill({
          body: pageOf(
            "A large cover",
            "",
            `<meta property="og:image" content="${PAGES}/cover.png">`,
          ),
          contentType: "text/html",
        }));
  });
  const site = await extension.newPage();
  const { save } = await openPanel(extension, cloud);
  await signIn(site, cloud, account);
  expect(await save("/large-cover")).toEqual({
    created: true,
    kind: "saved",
    title: "A large cover",
  });
  const { items } = await library.items.list({ kinds: ["link"] });
  const saved = items.find((item) => item.url === `${PAGES}/large-cover`);
  const { fields } = await library.items.row({ id: saved?.id ?? "" });
  expect(fields.coverSha).toBe(createHash("sha256").update(LARGE_COVER).digest("hex"));
  const kept = await download(cloud, account, fields.coverSha ?? "");
  expect(kept.equals(LARGE_COVER)).toBe(true);
});

test("the build carries the licence of a package only one of WXT's builds bundles", async () => {
  const folder = path.join(BUILD, "licenses");
  const files = await readdir(folder);

  const notices = await Promise.all(
    files.map(async (name) => await readFile(path.join(folder, name), "utf-8")),
  );

  expect(notices.join("\n")).toMatch(/^## react - \S+ \(MIT\)$/mu);
});
