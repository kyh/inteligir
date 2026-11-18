/**
 * The runtime gate against a running app, a deployment's or `next start`'s: its health, the site's
 * policy, the sign-in gate, the crons' secret, the build floor, and a signed-in call through two
 * doors and a file through the store. Calls go through the contract's own client, so a changed procedure shape
 * breaks this at typecheck.
 *
 *   pnpm smoke                        # against http://localhost:5174, signed in as the seeded login
 *   SMOKE_URL=https://... pnpm smoke  # against a deployment, signed in with SMOKE_EMAIL and
 *                                     #   SMOKE_PASSWORD when both are set
 *
 * With VERCEL_AUTOMATION_BYPASS_SECRET set, every request carries it past a deployment's protection.
 * On CI (`.github/workflows/smoke.yml`, the deployment's check) a leg that cannot run fails.
 */
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { styleText } from "node:util";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { LIBRARY_PAGE_PATH, SIGN_IN_PATH } from "@repo/contract/library-page";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { uploadBlob } from "@repo/contract/rpc/call-outcome";
import type { V1Transport } from "@repo/contract/rpc/call-outcome";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

interface Login {
  readonly email: string;
  readonly password: string;
}

type HeaderMap = Readonly<Record<string, string>>;

type Leg =
  | { readonly label: string; readonly run: () => Promise<void> }
  // a leg that does not run here: there is no login to sign in with
  | { readonly label: string; readonly skip: string };

// unset, or empty as a workflow passes a secret nobody set
const envOf = (name: string): string | undefined => {
  const value = process.env[name];
  return value === "" ? undefined : value;
};

const SMOKE_EMAIL = envOf("SMOKE_EMAIL");
const SMOKE_PASSWORD = envOf("SMOKE_PASSWORD");
const SMOKE_URL = envOf("SMOKE_URL");
const VERCEL_AUTOMATION_BYPASS_SECRET = envOf("VERCEL_AUTOMATION_BYPASS_SECRET");

// a gate runs every leg: one it skips would let a deployment through unchecked
const GATE = envOf("CI") !== undefined;

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

// apps/web/vercel.json's crons
const CRON_PATHS = ["/api/cron/agent", "/api/cron/housekeeping", "/api/cron/jobs"];

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

// a file of its own every run, so its bytes go to the store each time rather than meeting the last
// run's file held
const SMOKE_FILE_BYTES = 4096;

const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const expectBytes = async (response: Response, expected: Uint8Array, what: string) => {
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.equals(expected)) {
    fail(`${what} answered ${String(body.byteLength)} bytes that are not the file's`);
  }
};

/** A file's bytes up through `door` as every app sends them, by reserve, a PUT to the store reserve
 * names, and settle, then read back whole and by two ranges, as a media loader reads one. */
const fileRoundTrip = async (door: HeaderMap) => {
  const signed = { ...BUILD, ...door };
  const transport: V1Transport = {
    fetch: async (outgoing) => {
      const headers = new Headers(outgoing.headers);
      for (const [name, value] of Object.entries({ ...BYPASS, ...signed })) {
        headers.set(name, value);
      }
      return await fetch(new Request(outgoing, { headers, signal: deadline() }));
    },
    origin: BASE_URL,
  };
  const bytes = crypto.getRandomValues(new Uint8Array(SMOKE_FILE_BYTES));
  const sha = sha256Of(bytes);
  await uploadBlob(transport, { bytes, mime: "application/octet-stream", sha });

  const readAt = async (range: string | null): Promise<Response> =>
    await request(`${V1_BLOBS_PATH}/${sha}`, {
      headers: range === null ? signed : { ...signed, range },
    });
  const whole = await readAt(null);
  await expectStatus(whole, 200, "the whole file");
  await expectBytes(whole, bytes, "the whole file");
  const last = SMOKE_FILE_BYTES - 1;
  const parts = [
    { end: 9, range: "bytes=0-9", start: 0 },
    { end: last, range: "bytes=-1", start: last },
  ];
  for (const { end, range, start } of parts) {
    const part = await readAt(range);
    await expectStatus(part, 206, range);
    const spelled = `bytes ${String(start)}-${String(end)}/${String(SMOKE_FILE_BYTES)}`;
    const contentRange = part.headers.get("content-range");
    if (contentRange !== spelled) {
      fail(`${range} answered content-range ${contentRange ?? "none"}, not ${spelled}`);
    }
    await expectBytes(part, bytes.subarray(start, end + 1), range);
  }
};

/** The extension's door (the browser's signed session as a bearer), then the phone's (its cookie
 * under its scheme), each listing the account's library, which may be empty, and a file through
 * the extension's; both sessions end after. One sign-in a door, under the sign-in's 3 in 10 s. */
const signedInCalls = async (login: Login) => {
  const site = { origin: BASE_URL };
  const browser = await signIn(login, site);
  const extensionDoor = { authorization: `Bearer ${sessionToken(browser)}` };
  const asExtension = v1Client(extensionDoor);
  const phoneDoor = { "expo-origin": PHONE_ORIGIN };
  const phone = await signIn(login, phoneDoor);
  const asPhone = v1Client({ ...phoneDoor, cookie: phone });
  for (const client of [asExtension, asPhone]) {
    await client.library.items.list({ limit: 1 });
  }
  await fileRoundTrip(extensionDoor);
  await signOut(phone, phoneDoor);
  await signOut(browser, site);
};

const signedInLeg = (login: Login | null): Leg => {
  const label =
    "a signed-in call answers through the extension's door and the phone's, and a file goes up and reads back by range";
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
  {
    label: "the built-in agent answers /eve/v1/health",
    run: async () => {
      await expectStatus(await request("/eve/v1/health"), 200, "/eve/v1/health");
    },
  },
  {
    label: "every cron route refuses a call without its secret, 401",
    run: async () => {
      for (const path of CRON_PATHS) {
        await expectStatus(await request(path), 401, `${path} with no secret`);
        await expectStatus(
          await request(path, { headers: { authorization: "Bearer not-the-secret" } }),
          401,
          `${path} with another secret`,
        );
      }
    },
  },
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
    if (GATE) {
      fail(`${number} ${leg.label}: ${leg.skip}`);
    }
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
