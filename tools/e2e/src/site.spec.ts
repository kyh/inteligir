import { createHash } from "node:crypto";
import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { CONNECTOR_PATH } from "@repo/contract/connector";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
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

const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)(?<attributes>[^>]*)>(?<text>[\s\S]*?)<\/script>/gu;
const DATA_BLOCK = /type="application\/(?:ld\+)?json"/u;
// how a policy names an inline script it allows by its text
const hashSource = (text: string): string =>
  `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
const NEXT_CHUNK = /\/_next\/static\/chunks\/[\w.-]+\.(?:js|css)/gu;
const chunksOf = (html: string): Set<string> =>
  new Set([...html.matchAll(NEXT_CHUNK)].map((match) => match[0]));

// a document rendered per request, under its own policy: its scripts run by a nonce of its own, the
// theme script written by hand by its hash, and nothing else inline runs
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
    .map(({ groups }) => ({ attributes: groups?.attributes ?? "", text: groups?.text ?? "" }))
    .filter(({ attributes }) => !DATA_BLOCK.test(attributes))
    .filter(({ attributes }) => !attributes.includes(`nonce="${nonce}"`))
    .filter(({ text }) => !scripts.includes(hashSource(text)));
  expect(unsigned, `${url}'s inline scripts neither its nonce nor a hash allows`).toEqual([]);
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
    await readFile(path.join(REPO, "apps/desktop/scripts/release-assets.ts"), "utf-8"),
  )?.groups?.name;
  // releases/latest/download cannot know a version
  expect(dmg).not.toMatch(/\d+\.\d+/u);
  await page.goto(cloud.origin);
  await expect(page.getByRole("link", { name: "Download for Mac" }).first()).toHaveAttribute(
    "href",
    `https://github.com/kyh/inteligir/releases/latest/download/${dmg ?? ""}`,
  );
  await expect(page.getByText("Invite required during beta").first()).toBeVisible();

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

test("the home page's orb draws into the whole of its box", async ({ cloud, page }) => {
  await page.goto(cloud.origin);
  const orb = page.locator("canvas");
  const box = await orb.locator("..").boundingBox();
  await expect.poll(async () => await orb.boundingBox()).toEqual(box);
});

test.describe(() => {
  const NO_WEBGL = /Error creating WebGL context/u;
  test.use({ allowedErrors: NO_WEBGL });

  test("the home page stands where the orb gets no WebGL", async ({ cloud, page }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    const refused = page.waitForEvent("console", (message) => NO_WEBGL.test(message.text()));
    await page.goto(cloud.origin);
    await refused;
    await expect(page.getByRole("link", { name: "Download for Mac" }).first()).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
  });
});

// the licence of code a workspace vendored, which it keeps in its own licenses/
const vendoredTexts = async (): Promise<string[]> => {
  const texts: string[] = [];
  for await (const text of glob("{apps,packages,tools}/*/licenses/*.txt", { cwd: REPO })) {
    texts.push(text);
  }
  return texts;
};

test("the site serves the licences of the packages it bundles, which link each vendored text, served as kept", async ({
  cloud,
  request,
}) => {
  const packages = await request.get(`${cloud.origin}/licenses.md`);
  const licences = await packages.text();
  expect(licences).toMatch(/^## react - \S+ \(MIT\)$/mu);
  const texts = await vendoredTexts();
  expect(texts).not.toEqual([]);
  for (const text of texts) {
    const linked = `/licenses/${path.basename(text)}`;
    expect(licences).toContain(`](${linked})`);
    const served = await request.get(`${cloud.origin}${linked}`);
    expect(served.status(), linked).toBe(200);
    expect(await served.text(), linked).toBe(await readFile(path.join(REPO, text), "utf-8"));
  }
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
  await expect(page.getByRole("button", { name: "Toggle theme" })).toBeDisabled();
});

test("a signed-in page asked for with no session cookie goes to sign in and back, and a cookie whose session ended is no sign-in", async ({
  cloud,
  request,
}) => {
  const settings = `${LIBRARY_PAGE_PATH}/settings?from=mail`;
  for (const [asked, cookie, status, location] of [
    [LIBRARY_PAGE_PATH, "", 307, `/app/sign-in${wayBack(LIBRARY_PAGE_PATH)}`],
    [settings, "", 307, `/app/sign-in${wayBack(settings)}`],
    // the form is served and nothing loops
    ["/app/sign-in", "better-auth.session_token=ended", 200, undefined],
  ] as const) {
    const answer = await request.get(`${cloud.origin}${asked}`, {
      headers: { cookie },
      maxRedirects: 0,
    });
    expect([answer.status(), answer.headers().location], asked).toEqual([status, location]);
  }
});

// the skip streams in behind the form's boundary, so it lands by the page's own redirect, not a 307
test("sign-in and sign-up are skipped for someone signed in, to where they were going", async ({
  // signs the test's browser in
  account: _account,
  cloud,
  page,
}) => {
  const settings = `${LIBRARY_PAGE_PATH}/settings?from=mail`;
  await page.goto(`${cloud.origin}/app/sign-in`);
  await expect(page).toHaveURL(`${cloud.origin}${LIBRARY_PAGE_PATH}`);
  await page.goto(`${cloud.origin}/app/sign-up${wayBack(settings)}`);
  await expect(page).toHaveURL(`${cloud.origin}${settings}`);
});

test("each account page carries its own nonce policy, a marketing page the site's static one, and a path nothing serves is a 404", async ({
  cloud,
  request,
}) => {
  const signIn = await documentAt(request, `${cloud.origin}/app/sign-in`);
  const signUp = await documentAt(request, `${cloud.origin}/app/sign-up`);
  expect(signIn.nonce).not.toBe(signUp.nonce);
  for (const { headers } of [signIn, signUp]) {
    expect(headers["cache-control"]).toContain("no-cache");
    expect(headers).toMatchObject({
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    });
  }

  const home = await request.get(cloud.origin, { headers: { accept: "text/html" } });
  const policy = home.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("script-src 'self' 'unsafe-inline'");
  expect(policy).not.toContain("'nonce-");
  expect(policy).toContain(" ipc:");

  expect(await statusOf(request.get(`${cloud.origin}/libraryish`))).toBe(404);
  expect(await statusOf(request.get(`${cloud.origin}/no-route-answers-this`))).toBe(404);
});

test("each library document carries its own nonce policy, and the home page loads none of the library's code", async ({
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
    expect(headers["cache-control"]).toContain("no-cache");
    expect(headers).toMatchObject({
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    });
  }
  // what the library loads beyond what every document rendered per request does
  const signIn = await documentAt(request, `${cloud.origin}/app/sign-in`);
  const shared = chunksOf(signIn.html);
  const libraryOnly = [...chunksOf(library.html)].filter((chunk) => !shared.has(chunk));
  expect(libraryOnly.length).toBeGreaterThan(0);
  const home = await request.get(cloud.origin);
  const homeHtml = await home.text();
  expect(libraryOnly.filter((chunk) => homeHtml.includes(chunk))).toEqual([]);
});

// a path under each mount takes its own methods, and Next answers any other with a 405, never the
// site's HTML page
const expectProtocolAnswers = async (
  request: APIRequestContext,
  origin: string,
  rows: readonly {
    readonly headers?: Record<string, string>;
    readonly method: string;
    readonly route: string;
    readonly status: number;
  }[],
) => {
  for (const { headers = {}, method, route, status } of rows) {
    const response = await request.fetch(`${origin}${route}`, { headers, method });
    expect(response.status(), `${method} ${route}`).toBe(status);
    expect(response.headers()["content-type"] ?? "", `${method} ${route}`).not.toMatch(
      /^text\/html/u,
    );
  }
};

test("each mount hands its request to the service, which answers in its door's protocol", async ({
  cloud,
  request,
}) => {
  const build = buildOf(cloud);
  expect(await statusOf(request.get(`${cloud.origin}/api/auth/get-session`))).toBe(200);
  const devices = async (headers: Record<string, string>) =>
    await statusOf(request.post(`${cloud.origin}${DEVICES}`, { data: {}, headers }));
  expect(await devices({}), "an account call naming no build").toBe(426);
  expect(await devices(build), "an account call with no session").toBe(401);

  await expectProtocolAnswers(request, cloud.origin, [
    { method: "PUT", route: "/api/auth/get-session", status: 405 },
    { headers: build, method: "GET", route: DEVICES, status: 405 },
    { method: "GET", route: "/api/nope", status: 404 },
    { method: "POST", route: "/api/nope", status: 404 },
  ]);
});

test("the connector's routes answer in their own protocol", async ({ cloud, request }) => {
  await expectProtocolAnswers(request, cloud.origin, [
    { method: "GET", route: "/api/auth/oauth2/token", status: 404 },
    { method: "GET", route: "/api/auth/oauth2/nope", status: 404 },
    { method: "POST", route: "/.well-known/oauth-authorization-server/api/auth", status: 405 },
    { method: "POST", route: "/.well-known/oauth-protected-resource/connector", status: 405 },
    { method: "DELETE", route: CONNECTOR_PATH, status: 401 },
    {
      headers: { origin: "https://evil.example" },
      method: "POST",
      route: CONNECTOR_PATH,
      status: 403,
    },
  ]);
});
