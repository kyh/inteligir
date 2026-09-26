import { createHash, randomBytes } from "node:crypto";
import { createCloudClient } from "@repo/api/cloud/client";
import type { CloudClient } from "@repo/api/cloud/client";
import { PULL_MAX_LIMIT } from "@repo/api/cloud/sync/sync-schema";
import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import { POLL_INTERVAL_MS } from "inteligir/server/cloud/sync-cadence";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { AppInstance, InstanceApi } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { untilThreadIdle } from "../harness/threads";

const NOTE = "notes/plan.md";
const NOTE_BYTES = "# Plan\n\nShip the phone.\n";
const ASKED = "Tidy this plan";
const ASKED_AGAIN = "Draft the launch note";
const SOCKET_DEADLINE_MS = 30_000;
const DELIVERY_DEADLINE_MS = 30_000;

// the phone mints the id: 128 random bits, so a resend is one row
const mintDispatchId = (): string => randomBytes(16).toString("hex");

// a fresh thread id, spelled as the app's own
const mintThreadId = (): string => `thr_${randomBytes(8).toString("hex")}`;

const describeSync = (status: CloudStatusResponse): string =>
  status.state === "signed-in"
    ? `connected: ${String(status.connected)}, cursor ${status.cursor}, lastError: ${status.lastError ?? "none"}`
    : status.state;

// a sign-in arms its Mac's poll somewhere inside the login call
interface ArmedBetween {
  from: number;
  to: number;
}

const signIn = async (app: AppInstance, deviceName: string): Promise<ArmedBetween> => {
  const from = Date.now();
  const status = await app.api.cloud.login({ ...OWNER, deviceName });
  expect(status.state === "signed-in", `${deviceName}'s login answered ${status.state}`);
  return { from, to: Date.now() };
};

// the poll fires every POLL_INTERVAL_MS after it was armed: the earliest instant after `now` it could
const earliestPollAfter = (armed: ArmedBetween, now: number): number => {
  let polls = 1;
  while (armed.to + polls * POLL_INTERVAL_MS <= now) {
    polls += 1;
  }
  return Math.max(now, armed.from + polls * POLL_INTERVAL_MS);
};

const untilConnected = async (app: AppInstance, name: string): Promise<void> => {
  await pollUntil(
    async () => await app.api.cloud.status(),
    (status) => status.state === "signed-in" && status.connected,
    {
      deadlineMs: SOCKET_DEADLINE_MS,
      describe: (status) => `${name}'s socket never opened (${describeSync(status)})`,
    },
  );
  // the open requests a pass; letting it end leaves a ping as the only way to hear what follows.
  await app.api.cloud.syncNow();
};

// the log carries every event as json; only a request naming a dispatch is read here
const dispatchedRequestSchema = z.looseObject({
  dispatchId: z.string(),
  threadId: z.string(),
  type: z.literal("client/turn/requested"),
});
type DispatchedRequest = z.infer<typeof dispatchedRequestSchema>;

// the account's log as the phone pulls it
const pulledRequests = async (phone: CloudClient): Promise<DispatchedRequest[]> => {
  const requests: DispatchedRequest[] = [];
  let afterSeq = 0;
  for (;;) {
    const page = await phone.pull({ afterSeq, limit: PULL_MAX_LIMIT });
    expect(page.ok, `the phone's pull failed: ${page.ok ? "" : JSON.stringify(page.failure)}`);
    for (const row of page.value.events) {
      const request = dispatchedRequestSchema.safeParse(row.event);
      if (request.success) {
        requests.push(request.data);
      }
      afterSeq = row.seq;
    }
    if (!page.value.hasMore) {
      return requests;
    }
  }
};

const statusOf = async (phone: CloudClient, id: string) => {
  const answer = await phone.dispatchStatus([id]);
  expect(
    answer.ok,
    `the phone's status read failed: ${answer.ok ? "" : JSON.stringify(answer.failure)}`,
  );
  const [dispatch] = answer.value.dispatches;
  expect(dispatch !== undefined, `the status read named no row for ${id}`);
  return { desktopsOnline: answer.value.desktopsOnline, dispatch };
};

// how many times a Mac's copy of the thread holds the message the user sent
const timesAsked = async (api: InstanceApi, threadId: string, text: string): Promise<number> => {
  const { threads } = await api.threads.list({});
  if (!threads.some((listed) => listed.id === threadId)) {
    return 0;
  }
  const body = await api.threads.timeline({ threadId });
  expect(body.kind === "full", `timeline without afterSequence answers full, got "${body.kind}"`);
  return body.timeline.rows.filter(
    (row) => row.kind === "conversation" && row.role === "user" && row.text === text,
  ).length;
};

export const phoneDispatchHosted: Scenario = {
  description:
    "a phone's request waits in the dispatch inbox until a Mac signs in, runs there over the note it was asked from, and reaches the phone's pull; with two Macs listening, exactly one runs it, before a poll could; a Mac that stops taking the phone's requests is no longer counted as listening",
  name: "phone-dispatch-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account through the invite gate; the phone signs in");
    await signUp(worker.origin);
    const phoneLogin = await loginDevice(worker.origin, "E2E Phone");
    const phone = createCloudClient({ baseUrl: worker.origin, credential: phoneLogin.credential });

    // each vault syncs to a bare remote of its own, so the hosted vault plays no part
    const boot = async (name: string): Promise<AppInstance> =>
      await ctx.boot({
        extraEnv: { INTELIGIR_AGENT: "scripted", INTELIGIR_CLOUD_URL: worker.origin },
        name,
        vaultRemote: await ctx.bareRemote(name),
      });
    const a = await boot("a");
    await a.api.vault.write({ content: NOTE_BYTES, guard: { kind: "absent" }, path: NOTE });

    ctx.log("the phone asks while no Mac is signed in");
    const first = mintDispatchId();
    const firstThread = mintThreadId();
    const created = await phone.createDispatch({
      id: first,
      kind: "turn",
      originDocPath: NOTE,
      text: ASKED,
      threadId: firstThread,
      viewContext: {
        resource: NOTE,
        revision: createHash("sha256").update(NOTE_BYTES).digest("hex"),
        surface: "doc",
      },
    });
    expect(
      created.ok,
      `the dispatch was refused: ${created.ok ? "" : JSON.stringify(created.failure)}`,
    );
    const waiting = await statusOf(phone, first);
    expectEq(waiting.dispatch.state, "waiting", "a request with no Mac to claim it");
    expectEq(waiting.desktopsOnline, 0, "desktops online before any Mac signed in");

    ctx.log("A signs in, claims it and runs it");
    const aArmed = await signIn(a, "E2E Device A");
    await pollUntil(
      async () => {
        const listing = await a.api.threads.list({});
        return listing.threads.find((listed) => listed.id === firstThread);
      },
      (listed) => listed !== undefined,
      { deadlineMs: DELIVERY_DEADLINE_MS, describe: () => `A never listed ${firstThread}` },
    );
    await untilThreadIdle(a.api, firstThread);
    const { thread } = await a.api.threads.get({ threadId: firstThread });
    expectEq(thread.originDocPath, NOTE, "the thread's origin");
    const timeline = await a.api.threads.timeline({ threadId: firstThread });
    expect(timeline.kind === "full", "timeline without afterSequence answers full");
    const said = timeline.timeline.rows.flatMap((row) =>
      row.kind === "conversation" ? [`${row.role}: ${row.text}`] : [],
    );
    expect(said.includes(`user: ${ASKED}`), `A's timeline lacks the request:\n${said.join("\n")}`);
    expect(
      said.some((line) => line.startsWith("assistant: Noted:") && line.includes(NOTE)),
      `A's scripted reply does not name ${NOTE}:\n${said.join("\n")}`,
    );

    await a.api.cloud.syncNow();
    await pollUntil(
      async () => await pulledRequests(phone),
      (requests) => requests.some((request) => request.dispatchId === first),
      {
        deadlineMs: DELIVERY_DEADLINE_MS,
        describe: (requests) =>
          `the phone's pull holds ${requests.length} request(s), none for ${first}`,
      },
    );
    const firstSettled = await statusOf(phone, first);
    expectEq(firstSettled.dispatch.state, "delivered", "the first request's state");

    ctx.log("B signs in; both Macs listen on their sockets");
    const b = await boot("b");
    const bArmed = await signIn(b, "E2E Device B");
    await untilConnected(a, "A");
    await untilConnected(b, "B");
    // either Mac may take it, so neither one's poll may have run before it lands
    const asking = Date.now();
    const pollFloor = Math.min(
      earliestPollAfter(aArmed, asking),
      earliestPollAfter(bArmed, asking),
    );

    const second = mintDispatchId();
    const secondThread = mintThreadId();
    const asked = await phone.createDispatch({
      id: second,
      kind: "turn",
      text: ASKED_AGAIN,
      threadId: secondThread,
    });
    expect(
      asked.ok,
      `the second dispatch was refused: ${asked.ok ? "" : JSON.stringify(asked.failure)}`,
    );
    const listening = await statusOf(phone, second);
    expectEq(listening.desktopsOnline, 2, "desktops online with A and B");

    const windowMs = pollFloor - Date.now();
    expect(
      windowMs > 0,
      "a Mac's poll was due as the phone asked, so a delivery could not be told from it",
    );
    ctx.log(`one Mac must take it within ${windowMs}ms, before a poll could run`);
    await pollUntil(
      async () => {
        const status = await statusOf(phone, second);
        return status.dispatch.state;
      },
      (state) => state === "delivered",
      {
        deadlineMs: windowMs,
        describe: (state) => `the second request is still "${state}"`,
      },
    );
    expect(
      Date.now() < pollFloor,
      "delivered only after a poll could have run: the ping is unproven",
    );

    await a.api.cloud.syncNow();
    await b.api.cloud.syncNow();
    await a.api.cloud.syncNow();
    const onA = await timesAsked(a.api, secondThread, ASKED_AGAIN);
    const onB = await timesAsked(b.api, secondThread, ASKED_AGAIN);
    const pulled = await pulledRequests(phone);
    const inLog = pulled.filter((request) => request.dispatchId === second);
    expectEq(inLog.length, 1, "requests for the second dispatch in the account's log");
    expectEq(onA, 1, "requests for the second dispatch on A");
    expectEq(onB, 1, "requests for the second dispatch on B");

    ctx.log("B stops taking the phone's requests: the phone counts A alone, though B stays open");
    const listeningMacs = async (): Promise<number> => {
      const { desktopsOnline } = await statusOf(phone, second);
      return desktopsOnline;
    };
    await b.api.cloud.setPrefs({ phoneRequests: false });
    await pollUntil(listeningMacs, (count) => count === 1, {
      deadlineMs: SOCKET_DEADLINE_MS,
      describe: (count) => `the phone still counts ${count} Mac(s) after B turned requests off`,
    });
    await untilConnected(b, "B");
    expectEq(await listeningMacs(), 1, "Macs listening once B's socket is back");

    await b.api.cloud.setPrefs({ phoneRequests: true });
    await pollUntil(listeningMacs, (count) => count === 2, {
      deadlineMs: SOCKET_DEADLINE_MS,
      describe: (count) => `the phone counts ${count} Mac(s) after B turned requests on again`,
    });
  },
};
