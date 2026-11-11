import { safe } from "@orpc/client";
import { expect } from "@playwright/test";
import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { isOrpcError } from "@repo/contract/v1/errors";
import { openLibrary, phoneSession, signInOnSite, test } from "./fixtures";
import type { Cloud } from "./fixtures";

const SETTINGS = `${LIBRARY_PAGE_PATH}/settings`;

// the browser logs the favicon's fetches offline and the wrong password's 401
test.use({
  allowedErrors: /net::ERR_INTERNET_DISCONNECTED|401 \(Unauthorized\) \(\S+\/account\/delete\)/u,
});

const authPost = async (
  cloud: Cloud,
  route: string,
  body: Readonly<Record<string, string>>,
): Promise<number> => {
  const response = await globalThis.fetch(`${cloud.origin}${route}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: cloud.origin },
    method: "POST",
  });
  await response.arrayBuffer();
  return response.status;
};

test("the site's sign-up spends its invite, and a signed-out tab signs in and comes back", async ({
  cloud,
  context,
  page,
}) => {
  const person = { email: `${crypto.randomUUID()}@inteligir.local`, password: "e2e-sign-up-1234" };
  const inviteCode = await cloud.mint();
  await page.goto(`${cloud.origin}/app/sign-up`);
  const create = page.getByRole("button", { name: "Create account" });
  await expect(create).toBeEnabled();
  await page.getByLabel("Name").fill("E2E");
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(person.password);
  await page.getByLabel("Invite code").fill(inviteCode);
  await create.click();
  await expect(page.getByRole("list", { name: "Library" })).toBeVisible();
  await expect(page).toHaveURL(`${cloud.origin}${LIBRARY_PAGE_PATH}`);
  const reused = {
    email: "second@inteligir.local",
    inviteCode,
    name: "E2E",
    password: "x".repeat(12),
  };
  expect(await authPost(cloud, AUTH_API_PATHS.signUp, reused), "reusing the invite").toBe(403);

  // the library left first: a tab that loses its session leaves for the sign-in on its own
  const signedOut = async () => {
    await page.goto("about:blank");
    await context.clearCookies();
  };
  await signedOut();
  await page.goto(`${cloud.origin}${SETTINGS}`);
  await expect(page).toHaveURL((url) => url.pathname === "/app/sign-in");
  expect(new URL(page.url()).searchParams.get("next")).toBe(SETTINGS);
  await signInOnSite(page, person);
  await expect(page).toHaveURL(`${cloud.origin}${SETTINGS}`);

  await signedOut();
  await page.goto(`${cloud.origin}/app/sign-in`);
  await signInOnSite(page, person);
  await expect(page).toHaveURL(`${cloud.origin}${LIBRARY_PAGE_PATH}`);
});

test("Settings waits offline, ends another device, turns the agent off, signs out and deletes", async ({
  account,
  cloud,
  context,
  library,
  page,
}) => {
  const phone = await phoneSession(cloud, account);
  const phoneRefusal = async () => {
    const [error] = await safe(phone.library.agent.status());
    return isOrpcError(error) ? error.code : null;
  };
  expect(await phoneRefusal()).toBeNull();

  await openLibrary(page, cloud);
  await context.setOffline(true);
  await page.keyboard.press("ControlOrMeta+,");
  await expect(page.getByText(account.email)).toBeVisible();
  await expect
    .poll(async () => await page.getByText(NEEDS_CONNECTION).count())
    .toBeGreaterThanOrEqual(3);
  await context.setOffline(false);
  for (const shown of ["iPhone", "None. Claude or ChatGPT", "turns left today"]) {
    await expect(page.getByText(shown).first()).toBeVisible();
  }
  await expect(page.getByText(NEEDS_CONNECTION)).toHaveCount(0);
  const devices = page.getByRole("list", { name: "Devices" });
  const own = devices.getByRole("listitem").filter({ hasText: "This device" });
  await expect(own).toHaveCount(1);
  await expect(own.getByRole("button")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out iPhone" }).click();
  await expect.poll(phoneRefusal).toBe("UNAUTHORIZED");
  await expect(page.getByRole("button", { name: "Sign out iPhone" })).toBeHidden();

  await page.getByRole("switch", { name: "Built-in agent" }).click();
  await expect.poll(async () => await library.agent.status()).toMatchObject({ enabled: false });
  await expect(page.getByText("Off: it answers nothing")).toBeVisible();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/app/sign-in");
  const cookies = await context.cookies();
  expect(cookies.map(({ name }) => name)).not.toContainEqual(
    expect.stringContaining("session_token"),
  );
  // the tab's session alone: the account's other sign-in still answers
  await expect(library.agent.status()).resolves.toMatchObject({ enabled: false });
  await page.goto(`${cloud.origin}${SETTINGS}`);
  await signInOnSite(page, account);
  await expect(page).toHaveURL(`${cloud.origin}${SETTINGS}`);

  await page.getByRole("button", { name: "Delete account…" }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Delete everything" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Password").fill("not the password");
  await confirm.click();
  await expect(page.getByText("That email and password don't match an account.")).toBeVisible();
  await expect(library.agent.status()).resolves.toMatchObject({ enabled: false });
  await dialog.getByLabel("Password").fill(account.password);
  await confirm.click();
  await expect(page).toHaveURL((url) => !url.pathname.startsWith(LIBRARY_PAGE_PATH));
  const signIn = { email: account.email, password: account.password };
  expect(await authPost(cloud, "/api/auth/sign-in/email", signIn), "the deleted account").toBe(401);
});
