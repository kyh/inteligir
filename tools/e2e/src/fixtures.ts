// One Worker per Playwright worker: apps/web's build output under an in-process Miniflare, the
// scripted Claude beside it, and every outbound fetch answered from `cloud.pages` or failing the
// test. One account per test, signed in on the test's context and reachable through `/v1`.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- miniflare types its D1 binding with @cloudflare/workers-types, which this node program does not load, so the type-aware pass reads the database as an unresolved type */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { expect, test as base } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { clientBuildHeaders } from "@repo/contract/client-build";
import type { ClientBuild } from "@repo/contract/client-build";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { V1_RPC_PATH } from "@repo/contract/v1";
import type { V1Client } from "@repo/contract/v1";
import { serveMessagesFake } from "@repo/messages-fake/serve";
import { Miniflare, MiniflareWorkerConfigBaseSchema, Response, fetch } from "miniflare";
import type { MiniflareOptions, Request } from "miniflare";
import { z } from "zod";

const REPO = path.resolve(import.meta.dirname, "../../..");
const OUTPUT = path.join(REPO, "apps/web/.cloudflare/output/v0/workers/default");
// a `.test` name no resolver answers (RFC 6761), which the fill's guard judges as any site's
const PAGE_ORIGIN = "http://pages.inteligir.test";
const PASSWORD = "e2e-password-1234";
// the system networking stack's user agent, which the account's devices list names an iPhone by
const PHONE_USER_AGENT = "inteligir/1 CFNetwork/3826.500.111 Darwin/25.0.0";

type Json = z.infer<ReturnType<typeof z.json>>;
type Binding = { type: "text"; value: string } | { type: "json"; value: Json };
type Worker = NonNullable<MiniflareOptions["workers"]>[number];

const text = (value: string): Binding => ({ type: "text", value });
const json = (value: Json): Binding => ({ type: "json", value });

interface CloudOptions {
  // over cloudflare.config.ts's text bindings
  readonly vars?: Readonly<Record<string, string>>;
  // over its JSON bindings, each replaced whole
  readonly json?: Readonly<Record<string, Json>>;
}

// a page by its body (text/html unless `type` says otherwise), or a status with no page
export type PageAnswer =
  | { readonly body: string | Uint8Array<ArrayBuffer>; readonly type?: string }
  | { readonly status: number };

export interface Cloud {
  readonly origin: string;
  // an unspent invite code
  readonly mint: () => Promise<string>;
  // how the Worker's fetch of a path under the page host is answered
  readonly pages: Map<string, PageAnswer>;
  readonly pageUrl: (pathname: string) => string;
  // every path under the page host the Worker asked for, in order
  readonly fetched: readonly string[];
  // every other address it asked for, which fails the test that was running
  readonly strays: readonly string[];
  // the oldest build the Worker takes, which every client here names
  readonly build: string;
}

interface Cookie {
  readonly name: string;
  readonly value: string;
}

export interface Account {
  readonly email: string;
  readonly password: string;
  // the browser's sign-in
  readonly cookies: readonly Cookie[];
  // the sign-up's session cookie, signed, which the extension's door takes as a bearer
  readonly bearer: string;
  readonly client: V1Client["account"];
}

interface TestFixtures {
  account: Account;
  library: V1Client["library"];
  // a second browser signed in to the account, watched as the first is
  secondContext: BrowserContext;
  // the console errors a test causes on purpose, which the watch lets by
  allowedErrors: RegExp | null;
  strayWatch: null;
}

interface WorkerFixtures {
  cloudOptions: CloudOptions;
  cloud: Cloud;
}

const ManifestSchema = z.object({
  mainModule: z.string(),
  modules: z.record(
    z.string(),
    z.object({ type: z.enum(["cjs", "data", "esm", "json", "sourcemap", "text", "wasm"]) }),
  ),
});

const OutputSchema = z.looseObject({
  assets: z.looseObject({}).optional(),
  env: z.looseObject({ MIN_CLIENT_BUILD: z.looseObject({ value: z.string() }) }),
  manifest: ManifestSchema,
});

// asked of the OS before the boot, since the Worker's own origin is one of its bindings
const freePort = async (): Promise<number> => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = z.object({ port: z.number() }).parse(server.address());
  server.close();
  await once(server, "close");
  return port;
};

// the script the service's suites run too, since two spellings of the DDL drift
const exportSchema = (): string[] =>
  execFileSync("pnpm", ["--filter", "@repo/db", "run", "--silent", "export"], {
    cwd: REPO,
    encoding: "utf-8",
  })
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const builtWorker = async (outbound: (request: Request) => Promise<Response>) => {
  const raw: unknown = JSON.parse(await readFile(path.join(OUTPUT, "worker.config.json"), "utf-8"));
  const { assets, manifest, ...rest } = OutputSchema.parse(raw);
  const config = MiniflareWorkerConfigBaseSchema.parse({
    ...rest,
    assets: { ...assets, directory: path.join(OUTPUT, "assets"), hasUserWorker: true },
  });
  const modules = Object.fromEntries(
    await Promise.all(
      Object.entries(manifest.modules).map(async ([name, { type }]) => [
        name,
        { contents: await readFile(path.join(OUTPUT, "bundle", name), "utf-8"), type },
      ]),
    ),
  );
  return {
    build: rest.env.MIN_CLIENT_BUILD.value,
    worker: (env: Readonly<Record<string, Binding>>): Worker => ({
      config: {
        ...config,
        env: { ...config.env, ...env },
        manifest: { mainModule: manifest.mainModule, modules },
        // the production routes leave the local origin unrouted; the fill queues' consumers stay
        triggers: (config.triggers ?? []).filter((trigger) => trigger.type === "queue"),
      },
      dev: { outboundService: { handler: outbound, type: "fetcher" } },
    }),
  };
};

const buildHeaders = (cloud: Cloud): Record<string, string> => {
  const build: ClientBuild = { platform: "extension", version: cloud.build };
  return clientBuildHeaders(build);
};

const v1Client = (cloud: Cloud, headers: Readonly<Record<string, string>>): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({
      headers: { ...buildHeaders(cloud), ...headers },
      origin: cloud.origin,
      url: V1_RPC_PATH,
    }),
  );

const cookiesOf = (response: globalThis.Response): Cookie[] =>
  response.headers.getSetCookie().map((setCookie) => {
    const pair = setCookie.split(";")[0] ?? "";
    const at = pair.indexOf("=");
    return { name: pair.slice(0, at), value: pair.slice(at + 1) };
  });

const sessionValue = (cookies: readonly Cookie[]): string => {
  const session = cookies.find(({ name }) => name.endsWith("session_token"));
  if (session === undefined) {
    throw new Error("the answer set no session cookie");
  }
  return session.value;
};

// every console error and uncaught page error on a page of `context` that `allowed` does not name
export const watchErrors = (context: BrowserContext, allowed: RegExp | null): string[] => {
  const seen: string[] = [];
  const note = (said: string): void => {
    if (allowed?.test(said) !== true) {
      seen.push(said);
    }
  };
  context.on("console", (message) => {
    if (message.type() === "error") {
      note(`${message.text()} (${message.location().url})`);
    }
  });
  context.on("weberror", (error) => {
    note(String(error.error()));
  });
  return seen;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  cloudOptions: [{}, { option: true, scope: "worker" }],
  cloud: [
    async ({ cloudOptions }, use) => {
      const statements = exportSchema();
      const fake = await serveMessagesFake(0);
      const pages = new Map<string, PageAnswer>();
      const fetched: string[] = [];
      const strays: string[] = [];
      const outbound = async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        if (url.origin === fake.origin) {
          return await fetch(request);
        }
        const page = url.origin === PAGE_ORIGIN ? pages.get(url.pathname) : undefined;
        if (url.origin === PAGE_ORIGIN) {
          fetched.push(url.pathname);
        }
        if (page === undefined) {
          strays.push(url.href);
          return new Response("no page answers here", { status: 502 });
        }
        return "status" in page
          ? new Response("not found", { status: page.status })
          : new Response(page.body, {
              headers: { "content-type": page.type ?? "text/html; charset=utf-8" },
            });
      };
      const { build, worker } = await builtWorker(outbound);
      const port = await freePort();
      // a loopback name, as the extension's dev build names its cloud
      const origin = `http://localhost:${String(port)}`;
      const miniflare = new Miniflare({
        host: "127.0.0.1",
        port,
        workers: [
          worker({
            ANTHROPIC_FAKE_URL: text(fake.origin),
            BETTER_AUTH_SECRET: text("e2e-better-auth-secret-000000000000"),
            RATE_LIMIT_DISABLED: text("true"),
            // the connector's issuer and resource, which the build names as production's
            SITE_ORIGIN: text(origin),
            ...Object.fromEntries(
              Object.entries(cloudOptions.vars ?? {}).map(([name, value]) => [name, text(value)]),
            ),
            ...Object.fromEntries(
              Object.entries(cloudOptions.json ?? {}).map(([name, value]) => [name, json(value)]),
            ),
          }),
        ],
      });
      await miniflare.ready;
      const db = await miniflare.getD1Database("DB");
      // one batch is one transaction; splitting on `;` holds while no literal in the schema has one
      await db.batch(statements.map((statement) => db.prepare(statement)));
      await use({
        build,
        fetched,
        mint: async () => {
          const code = `E2E-${crypto.randomUUID()}`;
          await db.prepare("INSERT INTO invite_code (code) VALUES (?)").bind(code).run();
          return code;
        },
        origin,
        pageUrl: (pathname) => `${PAGE_ORIGIN}${pathname}`,
        pages,
        strays,
      });
      await miniflare.dispose();
      await fake.close();
      // a drop is a thinking block the thread replayed wrong, which the API refuses
      expect(fake.stats().drops, "the replayed thinking blocks Claude dropped").toBe(0);
    },
    { scope: "worker", timeout: 120_000 },
  ],
  strayWatch: [
    async ({ cloud }, use) => {
      const before = cloud.strays.length;
      await use(null);
      expect(cloud.strays.slice(before), "the Worker's fetches no page answered").toEqual([]);
    },
    { auto: true },
  ],
  allowedErrors: [null, { option: true }],
  context: async ({ allowedErrors, context }, use) => {
    const seen = watchErrors(context, allowedErrors);
    await use(context);
    expect(seen, "the page and console errors").toEqual([]);
  },
  account: async ({ cloud, context }, use) => {
    const email = `${crypto.randomUUID()}@inteligir.local`;
    // the site's own page, which ships with the Worker and names no build
    const sitePost = async (route: string, body: Readonly<Record<string, string>>) => {
      const response = await globalThis.fetch(`${cloud.origin}${route}`, {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          origin: cloud.origin,
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      });
      expect(response.status, route).toBe(200);
      return cookiesOf(response);
    };
    const inviteCode = await cloud.mint();
    const signedUp = await sitePost(AUTH_API_PATHS.signUp, {
      email,
      inviteCode,
      name: "E2E",
      password: PASSWORD,
    });
    // the browser signs in apart, so its sign-out leaves the test's own client signed in
    const cookies = await sitePost("/api/auth/sign-in/email", { email, password: PASSWORD });
    await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: cloud.origin })));
    const bearer = sessionValue(signedUp);
    const { account } = v1Client(cloud, { authorization: `Bearer ${bearer}` });
    await use({ bearer, client: account, cookies, email, password: PASSWORD });
  },
  library: async ({ account, cloud }, use) => {
    await use(v1Client(cloud, { authorization: `Bearer ${account.bearer}` }).library);
  },
  secondContext: async ({ account, allowedErrors, browser, cloud }, use) => {
    const context = await browser.newContext();
    const seen = watchErrors(context, allowedErrors);
    await context.addCookies(account.cookies.map((cookie) => ({ ...cookie, url: cloud.origin })));
    await use(context);
    await context.close();
    expect(seen, "the second browser's page and console errors").toEqual([]);
  },
});

// the account signed in again as the phone does: its cookie under its app scheme
export const phoneSession = async (cloud: Cloud, account: Account): Promise<V1Client> => {
  const headers = {
    "content-type": "application/json",
    "expo-origin": PHONE_ORIGIN,
    "user-agent": PHONE_USER_AGENT,
  };
  const response = await globalThis.fetch(`${cloud.origin}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: account.email, password: account.password }),
    headers,
    method: "POST",
  });
  expect(response.status, "the phone's sign-in").toBe(200);
  const cookie = cookiesOf(response)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  return v1Client(cloud, { cookie, "expo-origin": PHONE_ORIGIN });
};

// the library's page at `query`, once its rail has drawn
export const openLibrary = async (page: Page, cloud: Cloud, query = ""): Promise<void> => {
  await page.goto(`${cloud.origin}${LIBRARY_PAGE_PATH}${query}`);
  await expect(page.getByRole("list", { name: "Library" })).toBeVisible();
};

// the site's sign-in, filled once it has hydrated: what is typed before can be lost to hydration
export const signInOnSite = async (
  page: Page,
  account: Pick<Account, "email" | "password">,
): Promise<void> => {
  const submit = page.getByRole("button", { name: "Sign in" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await submit.click();
};

export const EDITOR = '[data-slate-editor="true"]';

// an id as every writer mints one for what it creates
export const newId = (): string => uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));

// a file's bytes kept at the sha they hash to, as every app sends one; its sha
export const upload = async (
  cloud: Cloud,
  account: Account,
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
): Promise<string> => {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const response = await globalThis.fetch(`${cloud.origin}${V1_BLOBS_PATH}/${sha}`, {
    body: bytes,
    headers: {
      ...buildHeaders(cloud),
      authorization: `Bearer ${account.bearer}`,
      "content-type": type,
    },
    method: "PUT",
  });
  expect(response.status, "the upload").toBe(201);
  return sha;
};

// `typed` at the end of the open note's line that reads `line`
export const typeAfter = async (page: Page, line: string, typed: string): Promise<void> => {
  const drawn = page.locator(EDITOR).getByText(line, { exact: true });
  const box = await drawn.boundingBox();
  if (box === null) {
    throw new Error(`"${line}" is not drawn`);
  }
  // clicked at its end, not its middle: a live edit landing before the editor reads the caret End
  // moved puts it back where the click left it
  await drawn.click({ position: { x: box.width - 1, y: box.height / 2 } });
  await page.keyboard.press("End");
  await page.keyboard.type(typed);
};

// the cell's markdown of an item, as a poll reads it
export const markdownOf = async (library: V1Client["library"], id: string): Promise<string> => {
  const { view } = await library.items.read({ id });
  return view.markdown;
};

// a kept file's bytes, as every app reads them
export const download = async (cloud: Cloud, account: Account, sha: string): Promise<Buffer> => {
  const response = await globalThis.fetch(`${cloud.origin}${V1_BLOBS_PATH}/${sha}`, {
    headers: { ...buildHeaders(cloud), authorization: `Bearer ${account.bearer}` },
  });
  expect(response.status, "the download").toBe(200);
  return Buffer.from(await response.arrayBuffer());
};
