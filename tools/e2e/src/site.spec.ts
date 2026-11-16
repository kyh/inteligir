import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { CONNECTOR_PATH } from "@repo/contract/connector";
import { CONNECT_EXTENSION_PATH } from "@repo/contract/extension/extension-connect";
import {
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
  socketUrl,
  V1_SOCKET_PATH,
} from "@repo/contract/library/library-socket";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { V1_RPC_PATH } from "@repo/contract/v1";
import { z } from "zod";
import { test } from "./fixtures";
import type { Account, Cloud } from "./fixtures";

const REPO = path.resolve(import.meta.dirname, "../../..");
const DEVICES = `${V1_RPC_PATH}/account/devices/list`;
const statusOf = async (answer: Promise<APIResponse>): Promise<number> => {
  const response = await answer;
  return response.status();
};
const buildOf = (cloud: Cloud) => clientBuildHeaders({ platform: "mobile", version: cloud.build });
// the browser's sign-in, as a request that is no browser's carries it
const cookieOf = (account: Account): string =>
  account.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
const wayBack = (asked: string): string => `?next=${encodeURIComponent(asked)}`;

// the first heading of a doc and the first sentence under it, as its page renders them
const docLandmarks = async (doc: string) => {
  const markdown = await readFile(path.join(REPO, doc), "utf-8");
  const lines = markdown.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# "));
  const paragraph: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "") {
      paragraph.push(line.trim());
    } else if (paragraph.length > 0) {
      break;
    }
  }
  const prose = paragraph
    .join(" ")
    .replaceAll(/\[(?<words>[^\]]*)\]\([^)]*\)/gu, "$<words>")
    .replaceAll(/[*_`]/gu, "");
  const stop = /[.!?](?:\s|$)/u.exec(prose);
  return {
    heading: (lines[at] ?? "").slice("# ".length),
    sentence: stop === null ? prose : prose.slice(0, stop.index + 1),
  };
};

const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)[^>]*>/gu;
const DATA_BLOCK = /type="application\/(?:ld\+)?json"/u;
// the library's chunk group and its route's stylesheet, by the name vite.config.ts gives them
const LIBRARY_ASSET = /\/assets\/library-[\w-]{8}\.(?:js|css)/gu;

// a document under the site's policy: its scripts run by a nonce of its own, and nothing inline
// runs without it
const documentAt = async (request: APIRequestContext, url: string, cookie = "") => {
  const response = await request.get(url, { headers: { accept: "text/html", cookie } });
  expect(response.ok(), `GET ${url}`).toBe(true);
  const policy = response.headers()["content-security-policy"] ?? "";
  const scripts = policy.split("; ").find((directive) => directive.startsWith("script-src")) ?? "";
  const nonce = /'nonce-(?<nonce>[^']+)'/u.exec(scripts)?.groups?.nonce ?? "";
  expect(nonce, `${url}'s scripts' nonce in ${policy}`).not.toBe("");
  expect(scripts).not.toContain("'unsafe-inline'");
  // the Mac app's commands stay out of every page
  expect(policy).toContain(" ipc:");
  const html = await response.text();
  const unsigned = [...html.matchAll(INLINE_SCRIPT)]
    .map((match) => match[0])
    .filter((tag) => !DATA_BLOCK.test(tag) && !tag.includes(`nonce="${nonce}"`));
  expect(unsigned, `${url}'s inline scripts without its nonce`).toEqual([]);
  return { headers: response.headers(), html, nonce };
};

test("the site's pages render their docs, and the home page links the latest Mac download", async ({
  cloud,
  page,
}) => {
  for (const [route, doc] of [
    ["/privacy", "docs/privacy.md"],
    ["/terms", "docs/terms.md"],
  ] as const) {
    const { heading, sentence } = await docLandmarks(doc);
    await page.goto(`${cloud.origin}${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.locator("main")).toContainText(sentence);
  }

  const dmg = /^const DMG_NAME = "(?<name>[^"]+)";$/mu.exec(
    await readFile(path.join(REPO, "apps/desktop/scripts/package.ts"), "utf-8"),
  )?.groups?.name;
  // releases/latest/download cannot know a version
  expect(dmg).not.toMatch(/\d+\.\d+/u);
  await page.goto(cloud.origin);
  await expect(page.getByRole("link", { name: "Download for Mac" }).first()).toHaveAttribute(
    "href",
    `https://github.com/kyh/inteligir/releases/latest/download/${dmg ?? ""}`,
  );
  for (const requirement of ["Apple silicon", "An account is required, by invite for now"]) {
    await expect(page.getByText(requirement).first()).toBeVisible();
  }

  // the policy's tables are the site's widest thing, and the fixed header must stay on a phone
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(`${cloud.origin}/privacy`);
  const widths = await page.evaluate(() => ({
    header: document.querySelector("header")?.getBoundingClientRect().right ?? Infinity,
    page: document.documentElement.scrollWidth,
  }));
  expect(widths.page).toBeLessThanOrEqual(390);
  expect(widths.header).toBeLessThanOrEqual(390);
});

test("a print is light under the dark theme, which stays on the screen", async ({
  cloud,
  page,
}) => {
  const background = async () =>
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto(`${cloud.origin}/privacy`);
  const light = await background();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect.poll(background).not.toBe(light);
  await page.emulateMedia({ media: "print" });
  await expect.poll(background).toBe(light);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
});

test("a chosen theme is drawn before any of the page's code runs", async ({ cloud, page }) => {
  await page.goto(`${cloud.origin}/privacy`);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
  // the document's own inline script alone, as on a load whose code has not arrived
  await page.route("**/*.js", async (route) => {
    await route.fulfill({ body: "", contentType: "text/javascript" });
  });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
});

test("the Worker answers for the session before a page loads: with no cookie a signed-in page goes to sign in and back, and sign-in is skipped for someone signed in", async ({
  account,
  cloud,
  request,
}) => {
  const signedIn = cookieOf(account);
  const settings = `${LIBRARY_PAGE_PATH}/settings?from=mail`;
  for (const [asked, cookie, status, location] of [
    [LIBRARY_PAGE_PATH, "", 307, `/app/sign-in${wayBack(LIBRARY_PAGE_PATH)}`],
    [settings, "", 307, `/app/sign-in${wayBack(settings)}`],
    [CONNECT_EXTENSION_PATH, "", 307, `/app/sign-in${wayBack(CONNECT_EXTENSION_PATH)}`],
    ["/app/sign-in", signedIn, 307, LIBRARY_PAGE_PATH],
    [`/app/sign-up${wayBack(settings)}`, signedIn, 307, settings],
    // a cookie whose session ended is no sign-in, so the form is served and nothing loops
    ["/app/sign-in", "better-auth.session_token=ended", 200, undefined],
  ] as const) {
    const answer = await request.get(`${cloud.origin}${asked}`, {
      headers: { cookie },
      maxRedirects: 0,
    });
    expect([answer.status(), answer.headers().location], asked).toEqual([status, location]);
  }
});

test("every document carries its own nonce policy, and the home page loads none of the library", async ({
  account,
  cloud,
  request,
}) => {
  const cookie = cookieOf(account);
  const library = await documentAt(request, `${cloud.origin}${LIBRARY_PAGE_PATH}`, cookie);
  const settings = await documentAt(
    request,
    `${cloud.origin}${LIBRARY_PAGE_PATH}/settings`,
    cookie,
  );
  expect(library.nonce).not.toBe(settings.nonce);
  for (const { headers } of [library, settings]) {
    expect(headers).toMatchObject({
      "cache-control": "no-cache",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    });
  }
  const stylesheets = [...library.html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gu)].map(
    (match) => /\bhref="(?<href>[^"]+)"/u.exec(match[0])?.groups?.href ?? "",
  );
  const libraryOnly = new Set([
    ...[...library.html.matchAll(LIBRARY_ASSET)].map((match) => match[0]),
    ...stylesheets,
  ]);
  expect(libraryOnly.size).toBeGreaterThan(0);
  const home = await documentAt(request, cloud.origin);
  expect([...libraryOnly].filter((asset) => home.html.includes(asset))).toEqual([]);

  expect(await statusOf(request.get(`${cloud.origin}/libraryish`))).toBe(404);
  expect(await statusOf(request.get(`${cloud.origin}/no-route-answers-this`))).toBe(404);
});

test("each mount hands its request to the service, which answers in its door's protocol", async ({
  account,
  cloud,
  request,
}) => {
  const build = buildOf(cloud);
  expect(await statusOf(request.get(`${cloud.origin}/api/auth/get-session`))).toBe(200);
  const devices = async (headers: Record<string, string>) =>
    await statusOf(request.post(`${cloud.origin}${DEVICES}`, { data: {}, headers }));
  expect(await devices({}), "an account call naming no build").toBe(426);
  expect(await devices(build), "an account call with no session").toBe(401);

  // a path under each mount: one that declared its methods would hand a wrong one to the site's
  // page, a 200 of HTML
  for (const { headers = {}, method, route, status } of [
    { method: "PUT", route: "/api/auth/get-session", status: 404 },
    { headers: build, method: "GET", route: DEVICES, status: 404 },
    { method: "GET", route: "/oauth/token", status: 405 },
    { method: "POST", route: "/.well-known/oauth-authorization-server", status: 405 },
    { method: "DELETE", route: CONNECTOR_PATH, status: 401 },
    { method: "PUT", route: "/connect/authorize", status: 405 },
  ]) {
    const response = await request.fetch(`${cloud.origin}${route}`, { headers, method });
    expect(response.status(), `${method} ${route}`).toBe(status);
    expect(response.headers()["content-type"] ?? "", `${method} ${route}`).not.toMatch(
      /^text\/html/u,
    );
  }
  for (const [method, route] of [
    ["GET", "/v1/nope"],
    ["POST", "/api/nope"],
    ["GET", "/oauth/nope"],
    ["GET", "/.well-known/nope"],
  ] as const) {
    const response = await request.fetch(`${cloud.origin}${route}`, { method });
    expect([response.status(), await response.text()], `${method} ${route}`).toEqual([
      404,
      "not found",
    ]);
  }

  // the account's socket, opened on its ticket through Start to the cell, answers its keepalive
  const { ticket } = await account.client.socketTicket();
  const socket = new WebSocket(socketUrl(cloud.origin, V1_SOCKET_PATH, ticket));
  await once(socket, "open");
  const answered = once(socket, "message");
  socket.send(SOCKET_KEEPALIVE_PING);
  const [frame] = await answered;
  socket.close();
  expect(z.object({ data: z.string() }).parse(frame).data).toBe(SOCKET_KEEPALIVE_PONG);
});
