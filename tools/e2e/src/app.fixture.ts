import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, open, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { expect, test as base } from "@playwright/test";
import type { BrowserContext, Page, PlaywrightWorkerOptions } from "@playwright/test";
import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { clientBuildHeaders } from "@repo/contract/client-build";
import type { ClientBuild } from "@repo/contract/client-build";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { uploadBlob } from "@repo/contract/rpc/call-outcome";
import type { V1Transport } from "@repo/contract/rpc/call-outcome";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import postgres from "postgres";
import type { Sql } from "postgres";
import { z } from "zod";
import { workerDatabase } from "./databases";
import { servePageRelay } from "./page-relay";
import type { PageRelay, Web } from "./page-relay";

const WEB = path.resolve(import.meta.dirname, "../../../apps/web");
const NEXT_BIN = path.join(WEB, "node_modules/next/dist/bin/next");
const AGENT_SERVER = path.join(WEB, ".output/server/index.mjs");
const BOOT_BUDGET_MS = 60_000;
const MAIL_BUDGET_MS = 10_000;
const PASSWORD = "e2e-password-1234";
const PHONE_USER_AGENT = "inteligir/1 CFNetwork/3826.500.111 Darwin/25.0.0";

export interface Cloud {
  readonly origin: string;
  readonly mint: () => Promise<string>;
  readonly pageHost: PageRelay["pageHost"];
  readonly sql: Sql;
  readonly strays: readonly string[];
  readonly build: string;
  readonly mailedResetLink: (to: string) => Promise<string>;
}

interface Cookie {
  readonly name: string;
  readonly value: string;
}

export interface Account {
  readonly email: string;
  readonly password: string;
  readonly cookies: readonly Cookie[];
  readonly bearer: string;
  readonly client: V1Client["account"];
}

interface TestFixtures {
  account: Account;
  library: V1Client["library"];
  secondContext: BrowserContext;
  allowedErrors: RegExp | null;
  web: Web;
}

interface WorkerFixtures {
  build: string;
  cloud: Cloud;
  cloudPort: number | null;
}

const freePort = async () => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = z.object({ port: z.number() }).parse(server.address());
  server.close();
  await once(server, "close");

  return port satisfies number;
};

const answersHealthy = async (url: string) => {
  try {
    const response = await fetch(url);

    return response.ok satisfies boolean;
  } catch {
    return false satisfies boolean;
  }
};

const serve = async (
  args: readonly string[],
  ready: string,
  env: NodeJS.ProcessEnv,
  log: string,
) => {
  const output = await open(log, "w");

  const server = spawn(process.execPath, args, {
    cwd: WEB,
    env,
    stdio: ["ignore", output.fd, output.fd],
  });

  const exited = once(server, "exit");

  const stop = async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill();
      await exited;
    }

    await output.close();
  };

  const deadline = Date.now() + BOOT_BUDGET_MS;

  while (server.exitCode === null && Date.now() < deadline) {
    if (await answersHealthy(ready)) {
      return stop satisfies () => Promise<void>;
    }

    await sleep(250);
  }

  await stop();
  throw new Error(`${ready} never answered; the server's output is in ${log}`);
};

const MAIL_TO = "[send-email] to: ";
const RESET_LINK = /https?:\/\/\S*\/api\/auth\/reset-password\/\S+/u;

const loggedResetLink = (log: string, to: string) => {
  const mail = log.split(MAIL_TO).findLast((entry) => entry.startsWith(`${to}\n`));

  return (mail === undefined ? null : (RESET_LINK.exec(mail)?.[0] ?? null)) satisfies string | null;
};

const buildHeaders = (cloud: Cloud) => {
  const build: ClientBuild = { platform: "extension", version: cloud.build };

  return clientBuildHeaders(build) satisfies Record<string, string>;
};

const v1Client = (cloud: Cloud, headers: Readonly<Record<string, string>>) =>
  createORPCClient<V1Client>(
    new RPCLink({
      headers: { ...buildHeaders(cloud), ...headers },
      origin: cloud.origin,
      url: V1_RPC_PATH,
    }),
  ) satisfies V1Client;

const cookiesOf = (response: Response) =>
  response.headers.getSetCookie().map((setCookie) => {
    const pair = setCookie.split(";")[0] ?? "";
    const at = pair.indexOf("=");

    return { name: pair.slice(0, at), value: pair.slice(at + 1) };
  }) satisfies Cookie[];

const sessionValue = (cookies: readonly Cookie[]) => {
  const session = cookies.find(({ name }) => name.endsWith("session_token"));

  if (session === undefined) {
    throw new Error("the answer set no session cookie");
  }

  return session.value satisfies string;
};

export const signUp = async (cloud: Cloud) => {
  const email = `${crypto.randomUUID()}@inteligir.local`;

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

  const cookies = await sitePost("/api/auth/sign-in/email", { email, password: PASSWORD });
  const bearer = sessionValue(signedUp);
  const { account } = v1Client(cloud, { authorization: `Bearer ${bearer}` });

  return { bearer, client: account, cookies, email, password: PASSWORD } satisfies Account;
};

export const libraryOf = (cloud: Cloud, account: Account) =>
  v1Client(cloud, { authorization: `Bearer ${account.bearer}` })
    .library satisfies V1Client["library"];

export const watchErrors = (context: BrowserContext, allowed: RegExp | null) => {
  const seen: string[] = [];

  const note = (said: string) => {
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

  return seen satisfies string[];
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  build: ["0.7.0", { scope: "worker" }],
  cloudPort: [null, { option: true, scope: "worker" }],
  cloud: [
    async ({ build, cloudPort }, use, { project, workerIndex }) => {
      const relay = await servePageRelay();

      try {
        const database = await workerDatabase(workerIndex);
        const origin = `http://localhost:${String(cloudPort ?? (await freePort()))}`;
        const agentOrigin = `http://127.0.0.1:${String(await freePort())}`;
        await mkdir(project.outputDir, { recursive: true });

        const outputOf = (name: string) =>
          path.join(project.outputDir, `${name}-${String(workerIndex)}`);

        const env: NodeJS.ProcessEnv = {
          AGENT_MOCK_MODEL: "true",
          APP_URL: origin,
          BETTER_AUTH_SECRET: "e2e-better-auth-secret-000000000000",
          EMAIL_MODE: "log",
          FILE_STORE_DIR: outputOf("files"),
          HOME: process.env.HOME,
          MIN_CLIENT_BUILD: build,
          NEXT_TELEMETRY_DISABLED: "1",
          PAGE_FETCH_RELAY_URL: relay.url,
          PATH: process.env.PATH,
          POSTGRES_URL: database,
          RATE_LIMIT_DISABLED: "true",
        };

        const { hostname, port } = new URL(agentOrigin);

        const stopAgent = await serve(
          [AGENT_SERVER],
          `${agentOrigin}/eve/v1/health`,
          {
            ...env,
            HOST: hostname,
            NITRO_HOST: hostname,
            NITRO_PORT: port,
            PORT: port,
            WORKFLOW_LOCAL_DATA_DIR: outputOf("agent-runs"),
          },
          `${outputOf("agent")}.log`,
        );

        try {
          const appLog = `${outputOf("next-start")}.log`;

          const stopApp = await serve(
            [NEXT_BIN, "start", "--port", new URL(origin).port],
            `${origin}/api/health`,
            { ...env, EVE_BASE_URL: agentOrigin, EVE_NEXT_PRODUCTION_ORIGIN: agentOrigin },
            appLog,
          );

          const sql = postgres(database, { max: 1 });
          await use({
            build,
            mailedResetLink: async (to) => {
              const deadline = Date.now() + MAIL_BUDGET_MS;

              while (Date.now() < deadline) {
                const link = loggedResetLink(await readFile(appLog, "utf-8"), to);

                if (link !== null) {
                  return link;
                }

                await sleep(250);
              }

              throw new Error(
                `no reset link was mailed to ${to}; the app's output is in ${appLog}`,
              );
            },
            mint: async () => {
              const code = `E2E-${crypto.randomUUID()}`;
              await sql`insert into invite_code ${sql({ code })}`;

              return code;
            },
            origin,
            pageHost: relay.pageHost,
            sql,
            strays: relay.strays,
          });
          await sql.end();
          await stopApp();
        } finally {
          await stopAgent();
        }
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
    const account = await signUp(cloud);
    await context.addCookies(account.cookies.map((cookie) => ({ ...cookie, url: cloud.origin })));
    await use(account);
  },
  library: async ({ account, cloud }, use) => {
    await use(libraryOf(cloud, account));
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

export const phoneSession = async (cloud: Cloud, account: Account) => {
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

  return v1Client(cloud, { cookie, "expo-origin": PHONE_ORIGIN }) satisfies V1Client;
};

export const openLibrary = async (page: Page, cloud: Cloud, query = "") => {
  await page.goto(`${cloud.origin}${LIBRARY_PAGE_PATH}${query}`);
  await expect(page.getByRole("list", { name: "Library" })).toBeVisible();
};

export const signInOnSite = async (page: Page, account: Pick<Account, "email" | "password">) => {
  const submit = page.getByRole("button", { name: "Sign in" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await submit.click();
};

export const EDITOR = '[data-slate-editor="true"]';

export const newId = () =>
  uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16))) satisfies string;

export const upload = async (
  cloud: Cloud,
  account: Account,
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
) => {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const signed = { ...buildHeaders(cloud), authorization: `Bearer ${account.bearer}` };

  const transport: V1Transport = {
    fetch: async (request) => {
      const headers = new Headers(request.headers);

      for (const [name, value] of Object.entries(signed)) {
        headers.set(name, value);
      }

      return await fetch(new Request(request, { headers }));
    },
    origin: cloud.origin,
  };

  await uploadBlob(transport, { bytes, mime: type, sha });

  return sha satisfies string;
};

export const typeAfter = async (
  page: Page,
  line: string,
  typed: string,
  { delay = 0 }: { readonly delay?: number } = {},
) => {
  await page.locator(EDITOR).getByText(line, { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(typed, { delay });
};

export const skipScriptedPaste = (browserName: PlaywrightWorkerOptions["browserName"]) => {
  test.skip(browserName === "firefox", "Firefox empties a scripted paste's clipboardData");
};

export const markdownOf = async (library: V1Client["library"], id: string) => {
  const { view } = await library.items.read({ id });

  return view.markdown satisfies string;
};

export const download = async (cloud: Cloud, account: Account, sha: string) => {
  const response = await fetch(`${cloud.origin}${V1_BLOBS_PATH}/${sha}`, {
    headers: { ...buildHeaders(cloud), authorization: `Bearer ${account.bearer}` },
  });

  expect(response.status, "the download").toBe(200);

  return Buffer.from(await response.arrayBuffer()) satisfies Buffer;
};
