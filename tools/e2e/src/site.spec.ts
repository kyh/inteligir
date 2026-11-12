import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { CONNECTOR_PATH } from "@repo/contract/connector";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
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
import type { Cloud } from "./fixtures";

const REPO = path.resolve(import.meta.dirname, "../../..");
const SHA = "a".repeat(64);
const DEVICES = `${V1_RPC_PATH}/account/devices/list`;
const statusOf = async (answer: Promise<APIResponse>): Promise<number> => {
  const response = await answer;
  return response.status();
};
const buildOf = (cloud: Cloud) => clientBuildHeaders({ platform: "mobile", version: cloud.build });

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
const documentAt = async (request: APIRequestContext, url: string) => {
  const response = await request.get(url, { headers: { accept: "text/html" } });
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

test("every document carries its own nonce policy, and the home page loads none of the library", async ({
  cloud,
  request,
}) => {
  const library = await documentAt(request, `${cloud.origin}${LIBRARY_PAGE_PATH}`);
  const settings = await documentAt(request, `${cloud.origin}${LIBRARY_PAGE_PATH}/settings`);
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

test("each door answers in its own protocol through Start's routes", async ({
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

  // a route that declared its methods would hand a wrong one to the site's page, a 200 of HTML
  for (const { headers = {}, method, route, status } of [
    { method: "PUT", route: "/api/auth/get-session", status: 404 },
    { method: "GET", route: AUTH_API_PATHS.signUp, status: 404 },
    { headers: build, method: "GET", route: DEVICES, status: 404 },
    { headers: build, method: "DELETE", route: `${V1_BLOBS_PATH}/${SHA}`, status: 405 },
    { method: "POST", route: V1_SOCKET_PATH, status: 400 },
    { method: "DELETE", route: CONNECTOR_PATH, status: 401 },
    {
      method: "POST",
      route: `/.well-known/oauth-protected-resource${CONNECTOR_PATH}`,
      status: 405,
    },
    { method: "POST", route: "/.well-known/oauth-authorization-server", status: 405 },
    { method: "GET", route: "/oauth/token", status: 405 },
    { method: "GET", route: "/oauth/register", status: 405 },
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
  ] as const) {
    const response = await request.fetch(`${cloud.origin}${route}`, { method });
    expect([response.status(), await response.text()], `${method} ${route}`).toEqual([
      404,
      "not found",
    ]);
  }

  // the account's socket, opened on its ticket through Start to the cell, answers its keepalive
  const { ticket } = await account.client.socketTicket();
  const socket = new WebSocket(socketUrl(cloud.origin, ticket));
  await once(socket, "open");
  const answered = once(socket, "message");
  socket.send(SOCKET_KEEPALIVE_PING);
  const [frame] = await answered;
  socket.close();
  expect(z.object({ data: z.string() }).parse(frame).data).toBe(SOCKET_KEEPALIVE_PONG);
});
