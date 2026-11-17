// One app per Playwright worker: `next start` on apps/web's build, over a database of its own cloned
// from the run's template (databases.ts), and every page it fetches answered from a test's
// `web.pages` or failing it (page-relay.ts). One account per test, signed in on the test's context
// and reachable through `/v1`.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, open } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
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
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import postgres from "postgres";
import { z } from "zod";
import { workerDatabase } from "./databases";
import { servePageRelay } from "./page-relay";
import type { Web } from "./page-relay";

const WEB = path.resolve(import.meta.dirname, "../../../apps/web");
const NEXT_BIN = path.join(WEB, "node_modules/next/dist/bin/next");
const BOOT_BUDGET_MS = 60_000;
const PASSWORD = "e2e-password-1234";
// the system networking stack's user agent, which the account's devices list names an iPhone by
const PHONE_USER_AGENT = "inteligir/1 CFNetwork/3826.500.111 Darwin/25.0.0";

export interface Cloud {
  readonly origin: string;
  // an unspent invite code
  readonly mint: () => Promise<string>;
  // a page host no other test has
  readonly pageHost: () => Web;
  // every address under no page host the app asked for, which fails the test that was running
  readonly strays: readonly string[];
  // the oldest build the app takes, which every client here names
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
  // the web as the app's fills reach it, which fails the test on a fetch no page answered
  web: Web;
}

interface WorkerFixtures {
  // the floor each app starts with, which every client here names: an install at it
  build: string;
  cloud: Cloud;
}

// asked of the OS before the boot, since the app's own origin is one of its variables
const freePort = async (): Promise<number> => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = z.object({ port: z.number() }).parse(server.address());
  server.close();
  await once(server, "close");
  return port;
};

const answersHealthy = async (origin: string): Promise<boolean> => {
  try {
    const response = await fetch(`${origin}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
};

// `next start` on the build `pnpm build` left in apps/web/.next, on `env` alone, so nothing of the
// root .env reaches it; ready once its health check answers, which waits on its database. Its
// output goes to `log`. Answers how to stop it.
const startApp = async (
  origin: string,
  env: NodeJS.ProcessEnv,
  log: string,
): Promise<() => Promise<void>> => {
  const output = await open(log, "w");
  const app = spawn(process.execPath, [NEXT_BIN, "start", "--port", new URL(origin).port], {
    cwd: WEB,
    env,
    stdio: ["ignore", output.fd, output.fd],
  });
  const exited = once(app, "exit");
  const stop = async () => {
    if (app.exitCode === null && app.signalCode === null) {
      app.kill();
      await exited;
    }
    await output.close();
  };
  const deadline = Date.now() + BOOT_BUDGET_MS;
  while (app.exitCode === null && Date.now() < deadline) {
    if (await answersHealthy(origin)) {
      return stop;
    }
    await sleep(250);
  }
  await stop();
  throw new Error(`next start never answered ${origin}/api/health; its output is in ${log}`);
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

const cookiesOf = (response: Response): Cookie[] =>
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
  build: ["0.7.0", { scope: "worker" }],
  cloud: [
    async ({ build }, use, { project, workerIndex }) => {
      const relay = await servePageRelay();
      try {
        const database = await workerDatabase(workerIndex);
        // a loopback name, as the extension's dev build names its cloud
        const origin = `http://localhost:${String(await freePort())}`;
        await mkdir(project.outputDir, { recursive: true });
        const stop = await startApp(
          origin,
          {
            AGENT_MOCK_MODEL: "true",
            APP_URL: origin,
            BETTER_AUTH_SECRET: "e2e-better-auth-secret-000000000000",
            EMAIL_MODE: "log",
            HOME: process.env.HOME,
            MIN_CLIENT_BUILD: build,
            NEXT_TELEMETRY_DISABLED: "1",
            PAGE_FETCH_RELAY_URL: relay.url,
            PATH: process.env.PATH,
            POSTGRES_URL: database,
            RATE_LIMIT_DISABLED: "true",
          },
          path.join(project.outputDir, `next-start-${String(workerIndex)}.log`),
        );
        const sql = postgres(database, { max: 1 });
        await use({
          build,
          mint: async () => {
            const code = `E2E-${crypto.randomUUID()}`;
            await sql`insert into invite_code ${sql({ code })}`;
            return code;
          },
          origin,
          pageHost: relay.pageHost,
          strays: relay.strays,
        });
        await sql.end();
        await stop();
      } finally {
        await relay.close();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
  web: [
    async ({ cloud }, use) => {
      const web = cloud.pageHost();
      const before = cloud.strays.length;
      await use(web);
      expect(
        [...web.strays, ...cloud.strays.slice(before)],
        "the app's fetches no page answered",
      ).toEqual([]);
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
    // the site's own page, which ships with the app and names no build
    const sitePost = async (route: string, body: Readonly<Record<string, string>>) => {
      const response = await fetch(`${cloud.origin}${route}`, {
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
  const response = await fetch(`${cloud.origin}/api/auth/sign-in/email`, {
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
  const response = await fetch(`${cloud.origin}${V1_BLOBS_PATH}/${sha}`, {
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

// an item's markdown, as a poll reads it
export const markdownOf = async (library: V1Client["library"], id: string): Promise<string> => {
  const { view } = await library.items.read({ id });
  return view.markdown;
};

// a kept file's bytes, as every app reads them
export const download = async (cloud: Cloud, account: Account, sha: string): Promise<Buffer> => {
  const response = await fetch(`${cloud.origin}${V1_BLOBS_PATH}/${sha}`, {
    headers: { ...buildHeaders(cloud), authorization: `Bearer ${account.bearer}` },
  });
  expect(response.status, "the download").toBe(200);
  return Buffer.from(await response.arrayBuffer());
};
