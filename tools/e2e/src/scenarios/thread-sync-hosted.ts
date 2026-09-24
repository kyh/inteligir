import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import type { TimelineRow } from "@repo/api/local/thread-timeline";
import { POLL_INTERVAL_MS } from "inteligir/server/cloud/sync-cadence";
import { expect } from "../harness/assert";
import { OWNER, signUp } from "../harness/cloud-account";
import type { AppInstance, InstanceApi } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { untilThreadIdle } from "../harness/threads";

const TURN_TEXT = "Sent on A, read on B";
const SOCKET_DEADLINE_MS = 30_000;

// what two devices must agree on, one line per row: a row's id and sequences are this device's
// arrival order.
const rowLine = (row: TimelineRow): string => {
  switch (row.kind) {
    case "conversation": {
      return `${row.role}: ${row.text}`;
    }
    case "work": {
      return `${row.workKind} ${row.status}`;
    }
    case "error": {
      return `error: ${row.message}`;
    }
    case "turn": {
      return `turn ${row.status} [${row.children.map(rowLine).join("; ")}]`;
    }
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
};

const timelineLines = async (api: InstanceApi, threadId: string): Promise<string[]> => {
  const body = await api.threads.timeline({ threadId });
  expect(body.kind === "full", `timeline without afterSequence answers full, got "${body.kind}"`);
  return body.timeline.rows.map(rowLine);
};

const describeSync = (status: CloudStatusResponse): string =>
  status.state === "signed-in"
    ? `connected: ${String(status.connected)}, cursor ${status.cursor}, ${status.pending} pending, lastError: ${status.lastError ?? "none"}`
    : status.state;

const signIn = async (app: AppInstance, deviceName: string): Promise<void> => {
  const status = await app.api.cloud.login({ ...OWNER, deviceName });
  expect(status.state === "signed-in", `${deviceName}'s login answered ${status.state}`);
};

export const threadSyncHosted: Scenario = {
  description:
    "a thread sent on A reaches B through a real dev Worker, carried by the socket's ping before B's poll could run",
  name: "thread-sync-hosted",
  // a cold wrangler dev boot alone may take its two-minute ready deadline.
  timeoutMs: 360_000,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account through the invite gate");
    await signUp(worker.origin);

    // each vault syncs to a bare remote of its own: on the hosted remote B's history would meet
    // A's as an unrelated one, a conflict beside the channel this scenario proves.
    const boot = async (name: string): Promise<AppInstance> =>
      await ctx.boot({
        extraEnv: { INTELIGIR_AGENT: "scripted", INTELIGIR_CLOUD_URL: worker.origin },
        name,
        vaultRemote: await ctx.bareRemote(name),
      });
    const a = await boot("a");
    const b = await boot("b");

    ctx.log("both devices sign in through the production route");
    await signIn(a, "E2E Device A");
    // B's poll timer arms inside its login, so no poll of B's can run before this instant.
    const pollFloor = Date.now() + POLL_INTERVAL_MS;
    await signIn(b, "E2E Device B");

    ctx.log("B's socket opens against the Durable Object");
    await pollUntil(
      async () => await b.api.cloud.status(),
      (status) => status.state === "signed-in" && status.connected,
      {
        deadlineMs: SOCKET_DEADLINE_MS,
        describe: (status) => `B's socket never opened (${describeSync(status)})`,
      },
    );
    // the open requests a pass; letting it end first leaves a ping as B's only way to hear of A.
    await b.api.cloud.syncNow();

    ctx.log("A sends a turn through the scripted driver");
    const { thread } = await a.api.threads.create({ title: "synced over the socket" });
    const sent = await a.api.threads.send({ text: TURN_TEXT, threadId: thread.id });
    expect(sent.kind === "started", `send outcome was "${sent.kind}"`);
    await untilThreadIdle(a.api, thread.id);
    const expected = await timelineLines(a.api, thread.id);
    expect(
      expected.includes(`user: ${TURN_TEXT}`),
      `A's timeline lacks the sent turn:\n${expected.join("\n")}`,
    );

    const windowMs = pollFloor - Date.now();
    expect(
      windowMs > 0,
      `the setup outlasted B's ${POLL_INTERVAL_MS}ms poll interval, so a delivery could not be told from a poll`,
    );
    ctx.log(`B must hold the thread within ${windowMs}ms, before its poll could run`);
    await pollUntil(
      async () => {
        const { threads } = await b.api.threads.list({});
        return {
          rows: threads.some((listed) => listed.id === thread.id)
            ? await timelineLines(b.api, thread.id)
            : null,
          status: await b.api.cloud.status(),
        };
      },
      (mirror) => mirror.rows !== null && mirror.rows.join("\n") === expected.join("\n"),
      {
        deadlineMs: windowMs,
        describe: (mirror) =>
          `B ${mirror.rows === null ? `never listed ${thread.id}` : `holds:\n${mirror.rows.join("\n")}`}\n` +
          `A holds:\n${expected.join("\n")}\nB's sync: ${describeSync(mirror.status)}`,
      },
    );
    // the last read can finish past the deadline check before it; only one inside the window
    // proves the ping.
    expect(
      Date.now() < pollFloor,
      `B converged only after its ${POLL_INTERVAL_MS}ms poll could have run, so the ping is unproven`,
    );
  },
};
