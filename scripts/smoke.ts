import { execFileSync } from "node:child_process";
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

import manifest from "../package.json" with { type: "json" };

type HeaderMap = Readonly<Record<string, string>>;

type Leg =
  | { readonly label: string; readonly run: () => Promise<void> }
  | { readonly label: string; readonly skip: string };

const envOf = (name: string) => {
  const value = process.env[name];

  return value === "" ? undefined : value;
};

const SMOKE_URL = envOf("SMOKE_URL");
const VERCEL_AUTOMATION_BYPASS_SECRET = envOf("VERCEL_AUTOMATION_BYPASS_SECRET");

const GATE = envOf("CI") !== undefined;

const BASE_URL = (SMOKE_URL ?? "http://localhost:5174").replace(/\/$/u, "");

const SEEDED_EMAIL = "dev@inteligir.local";

const BYPASS: HeaderMap =
  VERCEL_AUTOMATION_BYPASS_SECRET === undefined
    ? {}
    : { "x-vercel-protection-bypass": VERCEL_AUTOMATION_BYPASS_SECRET };

const CRON_PATHS = ["/api/cron/agent", "/api/cron/housekeeping", "/api/cron/jobs"];

const BUILD = clientBuildHeaders({ platform: "mobile", version: manifest.version });
const STALE_BUILD = clientBuildHeaders({ platform: "mobile", version: "0.0.1" });

const deadline = () => AbortSignal.timeout(15_000);

const BOOT_BUDGET_MS = 90_000;

class SmokeError extends Error {
  override name = "SmokeError";
}

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
) =>
  await fetch(`${BASE_URL}${path}`, {
    body,
    headers: { ...BYPASS, ...headers },
    method,
    redirect: "manual",
    signal: deadline(),
  });

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

const expectHtml = async (path: string) => {
  const response = await request(path, { headers: { accept: "text/html" } });
  await expectStatus(response, 200, path);
  const type = response.headers.get("content-type") ?? "no content type";

  if (!type.startsWith("text/html")) {
    fail(`${path} answered ${type}`);
  }

  return response;
};

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

const v1Client = (headers: HeaderMap) =>
  createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (input, init) => await fetch(input, { ...init, signal: deadline() }),
      headers: { ...BYPASS, ...BUILD, ...headers },
      origin: BASE_URL,
      url: V1_RPC_PATH,
    }),
  );

const mintedCode = (email: string) =>
  execFileSync("pnpm", ["--silent", "sign-in-code", email], { encoding: "utf-8" }).trim();

const signIn = async (email: string, door: HeaderMap) => {
  const response = await request("/api/auth/sign-in/email-otp", {
    body: JSON.stringify({ email, otp: mintedCode(email) }),
    headers: { ...door, "content-type": "application/json" },
    method: "POST",
  });

  await expectStatus(response, 200, `sign-in as ${email}`);

  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
};

const sessionToken = (cookie: string) =>
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

const SMOKE_FILE_BYTES = 4096;

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const expectBytes = async (response: Response, expected: Uint8Array, what: string) => {
  const body = Buffer.from(await response.arrayBuffer());

  if (!body.equals(expected)) {
    fail(`${what} answered ${String(body.byteLength)} bytes that are not the file's`);
  }
};

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

  const readAt = async (range: string | null) =>
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

const PHONE_DOOR = { "expo-origin": PHONE_ORIGIN };

const callsThroughDoors = async (extensionDoor: HeaderMap, phone: string) => {
  const asExtension = v1Client(extensionDoor);
  const asPhone = v1Client({ ...PHONE_DOOR, cookie: phone });

  for (const client of [asExtension, asPhone]) {
    await client.library.items.list({ limit: 1 });
  }

  await fileRoundTrip(extensionDoor);
};

const signedInCalls = async () => {
  const site = { origin: BASE_URL };
  const browser = await signIn(SEEDED_EMAIL, site);
  const phone = await signIn(SEEDED_EMAIL, PHONE_DOOR);
  await callsThroughDoors({ authorization: `Bearer ${sessionToken(browser)}` }, phone);
  await signOut(phone, PHONE_DOOR);
  await signOut(browser, site);
};

const signedInLeg = () => {
  const label =
    "a signed-in call answers through the extension's door and the phone's, and a file goes up and reads back by range";

  return (
    SMOKE_URL === undefined
      ? { label, run: signedInCalls }
      : { label, skip: "its sign-in code is minted in the local database, so it runs locally only" }
  ) satisfies Leg;
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
  signedInLeg(),
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
