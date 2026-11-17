/**
 * The runtime gate against a running app, a deployment's or `next start`'s: its health, the site's
 * policy, the sign-in gate, the build floor and a signed-in call through two doors. Calls go through
 * the contract's own client, so a changed procedure shape breaks this at typecheck.
 *
 *   pnpm smoke                        # against http://localhost:5174, signed in as the seeded login
 *   SMOKE_URL=https://... pnpm smoke  # against a deployment, signed in with SMOKE_EMAIL and
 *                                     #   SMOKE_PASSWORD when both are set
 *
 * With VERCEL_AUTOMATION_BYPASS_SECRET set, every request carries it past a deployment's protection.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { styleText } from "node:util";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { LIBRARY_PAGE_PATH, SIGN_IN_PATH } from "@repo/contract/library-page";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

interface Login {
  readonly email: string;
  readonly password: string;
}

type HeaderMap = Readonly<Record<string, string>>;

type Leg =
  | { readonly label: string; readonly run: () => Promise<void> }
  // a leg that does not run here: its route has not landed, or there is no login to sign in with
  | { readonly label: string; readonly skip: string };

const { SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_URL, VERCEL_AUTOMATION_BYPASS_SECRET } = process.env;
const BASE_URL = (SMOKE_URL ?? "http://localhost:5174").replace(/\/$/u, "");

// the seeded login locally; a deployment never holds the seeded account
const loginOf = (): Login | null => {
  if (SMOKE_URL === undefined) {
    return { email: "dev@inteligir.local", password: "password" };
  }
  return SMOKE_EMAIL === undefined || SMOKE_PASSWORD === undefined
    ? null
    : { email: SMOKE_EMAIL, password: SMOKE_PASSWORD };
};

const BYPASS: HeaderMap =
  VERCEL_AUTOMATION_BYPASS_SECRET === undefined
    ? {}
    : { "x-vercel-protection-bypass": VERCEL_AUTOMATION_BYPASS_SECRET };

// an install at the floor every deployment answers by default, and one below it
const BUILD = clientBuildHeaders({ platform: "mobile", version: "0.7.0" });
const STALE_BUILD = clientBuildHeaders({ platform: "mobile", version: "0.0.1" });

/** Node's fetch has no default timeout; a stalled server would hang CI instead of failing it. */
const deadline = () => AbortSignal.timeout(15_000);

/** A wall-clock budget, not an attempt count: an attempt takes milliseconds when refused but a
 * full timeout when the server accepts and stalls. */
const BOOT_BUDGET_MS = 90_000;

class SmokeError extends Error {
  override name = "SmokeError";
}

// The annotation is what lets TypeScript narrow after a `fail(...)` call.
const fail: (message: string) => never = (message) => {
  throw new SmokeError(message);
};

const request = async (
  path: string,
  {
    body,
    headers = {},
    method = "GET",
  }: { body?: string; headers?: HeaderMap; method?: string } = {},
): Promise<Response> =>
  await fetch(`${BASE_URL}${path}`, {
    body,
    headers: { ...BYPASS, ...headers },
    method,
    redirect: "manual",
    signal: deadline(),
  });

/** `status + body`, truncated, so a failure is readable without a rerun. */
const describeResponse = async (response: Response) => {
  const body = await response.text().catch(() => "<unreadable body>");
  const trimmed = body.replaceAll(/\s+/gu, " ").trim();
  return `HTTP ${String(response.status)} — ${trimmed.slice(0, 400) || "<empty body>"}`;
};

const expectStatus = async (response: Response, status: number, what: string) => {
  if (response.status !== status) {
    fail(`${what}: expected ${String(status)}, got ${await describeResponse(response)}`);
  }
};

const expectHtml = async (path: string): Promise<Response> => {
  const response = await request(path, { headers: { accept: "text/html" } });
  await expectStatus(response, 200, path);
  const type = response.headers.get("content-type") ?? "no content type";
  if (!type.startsWith("text/html")) {
    fail(`${path} answered ${type}`);
  }
  return response;
};

/** Polls until healthy. Every unhealthy outcome retries: a booting server accepts TCP well before
 * it can route, so early 404s and 500s are expected. */
const waitForServer = async () => {
  const startedAt = performance.now();
  let lastSeen = "no response at all";
  while (performance.now() - startedAt < BOOT_BUDGET_MS) {
    try {
      const response = await request("/api/health");
      if (response.ok) {
        return;
      }
      lastSeen = await describeResponse(response);
    } catch (error) {
      lastSeen = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  fail(`${BASE_URL} never answered /api/health within 90 s; last saw: ${lastSeen}`);
};

const v1Client = (headers: HeaderMap): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (input, init) => await fetch(input, { ...init, signal: deadline() }),
      headers: { ...BYPASS, ...BUILD, ...headers },
      origin: BASE_URL,
      url: V1_RPC_PATH,
    }),
  );

/** The session's cookies as a Cookie header. Better Auth checks the site's Origin, or reads the
 * phone's scheme in its place. */
const signIn = async (login: Login, door: HeaderMap): Promise<string> => {
  const response = await request("/api/auth/sign-in/email", {
    body: JSON.stringify(login),
    headers: { ...door, "content-type": "application/json" },
    method: "POST",
  });
  await expectStatus(response, 200, `sign-in as ${login.email}`);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
};

const sessionToken = (cookie: string): string =>
  /session_token=(?<token>[^;]+)/u.exec(cookie)?.groups?.token ??
  fail("the sign-in set no session cookie");

const signOut = async (cookie: string, door: HeaderMap) => {
  const response = await request("/api/auth/sign-out", {
    body: "{}",
    headers: { ...door, "content-type": "application/json", cookie },
    method: "POST",
  });
  await expectStatus(response, 200, "sign-out");
};

/** The extension's door (the browser's signed session as a bearer), then the phone's (its cookie
 * under its scheme), each answering for the account; both sessions end after. */
const signedInCalls = async (login: Login) => {
  const site = { origin: BASE_URL };
  const browser = await signIn(login, site);
  const asExtension = v1Client({ authorization: `Bearer ${sessionToken(browser)}` });
  const phoneDoor = { "expo-origin": PHONE_ORIGIN };
  const phone = await signIn(login, phoneDoor);
  const asPhone = v1Client({ ...phoneDoor, cookie: phone });
  for (const [door, client] of [
    ["extension", asExtension],
    ["phone", asPhone],
  ] as const) {
    const { devices } = await client.account.devices.list();
    if (devices.length === 0) {
      fail(`account.devices.list through the ${door}'s door named no device`);
    }
  }
  await signOut(phone, phoneDoor);
  await signOut(browser, site);
};

const signedInLeg = (login: Login | null): Leg => {
  const label = "a signed-in call answers through the extension's door and the phone's";
  return login === null
    ? { label, skip: "set SMOKE_EMAIL and SMOKE_PASSWORD" }
    : {
        label,
        run: async () => {
          await signedInCalls(login);
        },
      };
};

const LEGS: readonly Leg[] = [
  { label: "the app and its database answer /api/health", run: waitForServer },
  {
    label: "the home page is HTML under the site's static policy",
    run: async () => {
      const home = await expectHtml("/");
      const policy = home.headers.get("content-security-policy") ?? "";
      if (!policy.includes("script-src 'self' 'unsafe-inline'") || policy.includes("'nonce-")) {
        fail(`/ carries no static policy: ${policy || "none"}`);
      }
    },
  },
  {
    label: "/privacy renders",
    run: async () => {
      await expectHtml("/privacy");
    },
  },
  {
    label: `${LIBRARY_PAGE_PATH} sends a signed-out visit to sign in and back`,
    run: async () => {
      const response = await request(LIBRARY_PAGE_PATH);
      await expectStatus(response, 307, LIBRARY_PAGE_PATH);
      const location = new URL(response.headers.get("location") ?? "", BASE_URL);
      const expected = `${SIGN_IN_PATH}?next=${encodeURIComponent(LIBRARY_PAGE_PATH)}`;
      if (`${location.pathname}${location.search}` !== expected) {
        fail(`${LIBRARY_PAGE_PATH} went to ${location.href}, not ${expected}`);
      }
    },
  },
  { label: "/eve/v1/health answers 200", skip: "waits for the agent on eve" },
  { label: "/api/cron/jobs refuses a call without its secret, 401", skip: "waits for the crons" },
  {
    label: "a build below the floor is refused with 426",
    run: async () => {
      const response = await request(`${V1_RPC_PATH}/account/devices/list`, {
        body: JSON.stringify({ json: {} }),
        headers: { ...STALE_BUILD, "content-type": "application/json" },
        method: "POST",
      });
      await expectStatus(response, 426, "a call from build 0.0.1");
    },
  },
  signedInLeg(loginOf()),
];

const runLeg = async (number: string, leg: Leg) => {
  if ("skip" in leg) {
    console.log(`  ${styleText("dim", `○ ${number} ${leg.label}: ${leg.skip}`)}`);
    return;
  }
  const startedAt = performance.now();
  try {
    await leg.run();
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    fail(`${number} ${error instanceof SmokeError ? said : `${leg.label}: ${said}`}`);
  }
  const elapsed = styleText("dim", `${String(Math.round(performance.now() - startedAt))}ms`);
  console.log(`  ${styleText("green", "✓")} ${number} ${leg.label} ${elapsed}`);
};

try {
  console.log(`\n  Smoke test → ${BASE_URL}\n`);
  for (const [index, leg] of LEGS.entries()) {
    await runLeg(`${String(index + 1)}.`, leg);
  }
  console.log(`\n  ${styleText("green", "Smoke test passed.")}\n`);
} catch (error) {
  const said = error instanceof Error ? error.message : String(error);
  console.error(`\n  ${styleText("red", "✗ Smoke test failed:")} ${said}\n`);
  process.exit(1);
}
