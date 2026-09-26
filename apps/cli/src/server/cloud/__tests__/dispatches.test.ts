import { writeFileSync } from "node:fs";
import path from "node:path";
import { createCloudClient, postDeviceLogin } from "@repo/api/cloud/client";
import type { CloudClient, CloudFetch } from "@repo/api/cloud/client";
import { DISPATCH_API_PATHS } from "@repo/api/cloud/dispatch/dispatch-schema";
import type { SocketListener } from "@repo/api/cloud/sync/sync-ws";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import { listStoredThreadEvents, threadHoldsDispatch } from "@repo/db/events";
import { createPendingInteraction, getPendingInteraction } from "@repo/db/pending-interactions";
import type { PendingInteractionRow } from "@repo/db/pending-interactions";
import { noopNotifier } from "@repo/domain/notifier";
import { describe, expect, it } from "vitest";
import { bootThreadHarness } from "../../__tests__/boot-app";
import type { ThreadHarness } from "../../__tests__/boot-app";
import { approvalIdOf } from "../dispatches";
import { FAKE_ACCOUNT, FakeCloud } from "./fake-cloud";

const TURN = "a".repeat(32);
const ANSWER = "c".repeat(32);

const APPROVAL: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "deny"],
  kind: "approval",
  reason: null,
  subject: { command: "ls", cwd: null, itemId: "item_1", kind: "command" },
};

// pollIntervalMs: null, so every pass is one the test runs.
const bootMac = async (cloud: FakeCloud, fetch: CloudFetch = cloud.fetch): Promise<ThreadHarness> =>
  await bootThreadHarness({ mode: "manual" }, { cloudTransport: { fetch, pollIntervalMs: null } });

const signInMac = async (mac: ThreadHarness): Promise<void> => {
  const status = await mac.client.cloud.login({ ...FAKE_ACCOUNT, deviceName: "Mac" });
  expect(status.state).toBe("signed-in");
};

// the phone is another device on the account, speaking the wire as the app does
const signInPhone = async (cloud: FakeCloud): Promise<CloudClient> => {
  const baseUrl = "https://cloud.test";
  const login = await postDeviceLogin(
    { baseUrl, fetch: cloud.fetch },
    { ...FAKE_ACCOUNT, deviceName: "Phone" },
  );
  if (!login.ok) {
    throw new Error(`the phone could not sign in: ${JSON.stringify(login.failure)}`);
  }
  return createCloudClient({ baseUrl, credential: login.value.credential, fetch: cloud.fetch });
};

const askFromPhone = async (phone: CloudClient, threadId: string, id = TURN): Promise<void> => {
  const created = await phone.createDispatch({ id, kind: "turn", text: "Tidy it", threadId });
  expect(created.ok).toBe(true);
};

const requestCount = (mac: ThreadHarness, threadId: string): number =>
  listStoredThreadEvents(mac.db, { threadId }).filter(
    ({ event }) => event.type === "client/turn/requested",
  ).length;

const routeOf = (input: string): string => new URL(input).pathname;

describe("a phone's request reaching a Mac", () => {
  it("is claimed, run through the thread, then acked delivered, in that order", async () => {
    const cloud = new FakeCloud();
    const heldAtAck: boolean[] = [];
    let mac: ThreadHarness | null = null;
    const fetch: CloudFetch = async (input, init) => {
      if (routeOf(input) === DISPATCH_API_PATHS.ack && mac !== null) {
        heldAtAck.push(threadHoldsDispatch(mac.db, { dispatchId: TURN, threadId: "thr_phone" }));
      }
      return await cloud.fetch(input, init);
    };
    mac = await bootMac(cloud, fetch);
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");

    await signInMac(mac);

    const claim = cloud.requests.indexOf(`POST ${DISPATCH_API_PATHS.claim}`);
    const ack = cloud.requests.indexOf(`POST ${DISPATCH_API_PATHS.ack}`);
    expect(claim).toBeGreaterThan(-1);
    expect(ack).toBeGreaterThan(claim);
    expect(heldAtAck).toEqual([true]);
    expect(mac.driver.startedTurns.map((turn) => turn.dispatchId)).toEqual([TURN]);
    expect(cloud.dispatchStatus(TURN).state).toBe("delivered");
  });

  it("runs once when its ack is lost: the lapsed row comes back and is acked from the thread", async () => {
    const cloud = new FakeCloud();
    let dropAck = true;
    const fetch: CloudFetch = async (input, init) => {
      if (dropAck && routeOf(input) === DISPATCH_API_PATHS.ack) {
        dropAck = false;
        throw new Error("connection reset");
      }
      return await cloud.fetch(input, init);
    };
    const mac = await bootMac(cloud, fetch);
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");
    await signInMac(mac);
    expect(cloud.dispatchStatus(TURN).state).toBe("claimed");

    cloud.lapseClaims();
    await mac.client.cloud.syncNow();

    expect(cloud.dispatchStatus(TURN).state).toBe("delivered");
    expect(requestCount(mac, "thr_phone")).toBe(1);
    expect(mac.driver.startedTurns).toHaveLength(1);
  });

  it("is acked without a turn by a second Mac that pulled the first one's request for it", async () => {
    const cloud = new FakeCloud();
    let dropAck = true;
    const dropFirstAck: CloudFetch = async (input, init) => {
      if (dropAck && routeOf(input) === DISPATCH_API_PATHS.ack) {
        dropAck = false;
        throw new Error("connection reset");
      }
      return await cloud.fetch(input, init);
    };
    const first = await bootMac(cloud, dropFirstAck);
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");
    await signInMac(first);
    // the pass after the one that ran it pushes what it appended
    await first.client.cloud.syncNow();
    cloud.lapseClaims();

    const second = await bootMac(cloud);
    await signInMac(second);

    expect(cloud.dispatchStatus(TURN).state).toBe("delivered");
    expect(second.driver.startedTurns).toEqual([]);
    expect(requestCount(second, "thr_phone")).toBe(1);
    expect(first.driver.startedTurns).toHaveLength(1);
  });

  it("is refused back to the phone when the thread is archived here", async () => {
    const cloud = new FakeCloud();
    const mac = await bootMac(cloud);
    const { thread } = await mac.client.threads.create({});
    await mac.client.threads.archive({ threadId: thread.id });
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, thread.id);

    await signInMac(mac);

    expect(cloud.dispatchStatus(TURN)).toEqual({
      id: TURN,
      message: "That action is archived.",
      state: "refused",
    });
  });

  it("is never claimed by a Mac that is signed out", async () => {
    const cloud = new FakeCloud();
    const mac = await bootMac(cloud);
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");
    const before = cloud.requests.length;

    await mac.client.cloud.syncNow();

    expect(cloud.requests).toHaveLength(before);
    expect(cloud.dispatchStatus(TURN).state).toBe("waiting");
  });

  it("is not run under a sign-in that ended while the claim was in flight", async () => {
    const cloud = new FakeCloud();
    let mac: ThreadHarness | null = null;
    let signOutAtClaim = false;
    const fetch: CloudFetch = async (input, init) => {
      if (signOutAtClaim && mac !== null && routeOf(input) === DISPATCH_API_PATHS.claim) {
        signOutAtClaim = false;
        await mac.client.cloud.logout();
      }
      return await cloud.fetch(input, init);
    };
    mac = await bootMac(cloud, fetch);
    await signInMac(mac);
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");
    signOutAtClaim = true;

    await mac.client.cloud.syncNow();

    expect(requestCount(mac, "thr_phone")).toBe(0);
    expect(cloud.requests).not.toContain(`POST ${DISPATCH_API_PATHS.ack}`);
  });

  it("is left waiting by a Mac whose person turned phone requests off", async () => {
    const cloud = new FakeCloud();
    const mac = await bootMac(cloud);
    expect(await mac.client.cloud.prefs()).toEqual({ phoneRequests: true });
    expect(await mac.client.cloud.setPrefs({ phoneRequests: false })).toEqual({
      phoneRequests: false,
    });
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");

    await signInMac(mac);

    expect(cloud.requests).not.toContain(`POST ${DISPATCH_API_PATHS.claim}`);
    expect(cloud.dispatchStatus(TURN).state).toBe("waiting");
    expect(mac.driver.startedTurns).toEqual([]);

    await mac.client.cloud.setPrefs({ phoneRequests: true });
    await mac.client.cloud.syncNow();
    expect(cloud.dispatchStatus(TURN).state).toBe("delivered");
  });

  it("is left waiting when this Mac's choice cannot be read, which the status says", async () => {
    const cloud = new FakeCloud();
    const mac = await bootMac(cloud);
    writeFileSync(path.join(mac.dataDir, "cloud-prefs.json"), "{ not json");
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");

    await signInMac(mac);

    expect(cloud.requests).not.toContain(`POST ${DISPATCH_API_PATHS.claim}`);
    expect(cloud.dispatchStatus(TURN).state).toBe("waiting");
    const status = await mac.client.cloud.status();
    expect(status.state === "signed-in" && status.lastError).toContain("cloud-prefs.json");
  });
});

// a Mac recording every dial's listener, in order; the socket never opens, so no pass rides it
const bootListening = async (cloud: FakeCloud) => {
  const dials: SocketListener[] = [];
  const mac = await bootThreadHarness(
    { mode: "manual" },
    {
      cloudTransport: {
        fetch: cloud.fetch,
        openSocket: (args) => {
          dials.push(args.listener);
          return { close: () => {} };
        },
        pollIntervalMs: null,
      },
    },
  );
  return { dials, mac };
};

describe("the Mac's socket", () => {
  it("says whether this Mac takes a phone's requests, and dials again when that changes", async () => {
    const { dials, mac } = await bootListening(new FakeCloud());
    await mac.client.cloud.setPrefs({ phoneRequests: false });
    expect(dials).toEqual([]);

    await signInMac(mac);
    await mac.client.cloud.setPrefs({ phoneRequests: true });

    expect(dials).toEqual([
      { phoneRequests: false, platform: "desktop" },
      { phoneRequests: true, platform: "desktop" },
    ]);
  });

  it("does not say it takes them when its choice cannot be read", async () => {
    const { dials, mac } = await bootListening(new FakeCloud());
    writeFileSync(path.join(mac.dataDir, "cloud-prefs.json"), "{ not json");

    await signInMac(mac);

    expect(dials).toEqual([{ phoneRequests: false, platform: "desktop" }]);
  });
});

// the agent runtime raises the row; the fake driver has none, so the test raises it as the
// runtime would, on the turn the phone started
const raiseApproval = (mac: ThreadHarness, threadId: string): PendingInteractionRow => {
  const turn = mac.driver.startedTurns.at(-1);
  if (turn === undefined) {
    throw new Error("expected a started turn to raise an approval on");
  }
  return createPendingInteraction(mac.db, noopNotifier, {
    payload: JSON.stringify(APPROVAL),
    requestKey: `req_${turn.turnId}`,
    threadId,
    turnId: turn.turnId,
  });
};

describe("a phone-started turn's approval", () => {
  it("is offered to the phone, answered there, applied here, and taken back", async () => {
    const cloud = new FakeCloud();
    const mac = await bootMac(cloud);
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");
    await signInMac(mac);
    const asked = raiseApproval(mac, "thr_phone");

    await mac.client.cloud.syncNow();
    const [offered] = cloud.openApprovals();
    expect(offered).toMatchObject({
      id: approvalIdOf(asked.id),
      payload: APPROVAL,
      state: "open",
      threadId: "thr_phone",
      turnId: asked.turnId,
    });

    const answered = await phone.createDispatch({
      approvalId: approvalIdOf(asked.id),
      decision: "allow_once",
      id: ANSWER,
      kind: "answer",
    });
    expect(answered.ok).toBe(true);
    await mac.client.cloud.syncNow();

    expect(getPendingInteraction(mac.db, asked.id)).toMatchObject({
      relay: "closed",
      resolution: "allow_once",
      status: "resolved",
    });
    expect(cloud.dispatchStatus(ANSWER).state).toBe("delivered");
    expect(cloud.openApprovals()).toEqual([]);
  });

  it("is taken back from the phone once it is answered on the Mac", async () => {
    const cloud = new FakeCloud();
    const mac = await bootMac(cloud);
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");
    await signInMac(mac);
    const asked = raiseApproval(mac, "thr_phone");
    await mac.client.cloud.syncNow();
    expect(cloud.openApprovals()).toHaveLength(1);

    await mac.client.threads.answerInteraction({
      interactionId: asked.id,
      resolution: "deny",
      threadId: "thr_phone",
    });
    await mac.client.cloud.syncNow();

    expect(cloud.openApprovals()).toEqual([]);
    const late = await phone.createDispatch({
      approvalId: approvalIdOf(asked.id),
      decision: "allow_once",
      id: ANSWER,
      kind: "answer",
    });
    expect(late.ok && late.value.dispatch.state).toBe("refused");
  });

  it("reads delivered again when the answer comes back after a lost ack", async () => {
    const cloud = new FakeCloud();
    let dropAnswerAck = false;
    const fetch: CloudFetch = async (input, init) => {
      if (dropAnswerAck && routeOf(input) === DISPATCH_API_PATHS.ack) {
        dropAnswerAck = false;
        throw new Error("connection reset");
      }
      return await cloud.fetch(input, init);
    };
    const mac = await bootMac(cloud, fetch);
    const phone = await signInPhone(cloud);
    await askFromPhone(phone, "thr_phone");
    await signInMac(mac);
    const asked = raiseApproval(mac, "thr_phone");
    await mac.client.cloud.syncNow();
    await phone.createDispatch({
      approvalId: approvalIdOf(asked.id),
      decision: "allow_once",
      id: ANSWER,
      kind: "answer",
    });
    dropAnswerAck = true;
    await mac.client.cloud.syncNow();
    expect(getPendingInteraction(mac.db, asked.id)?.status).toBe("resolved");

    cloud.lapseClaims();
    await mac.client.cloud.syncNow();

    expect(cloud.dispatchStatus(ANSWER).state).toBe("delivered");
  });

  it("is never offered for a turn asked for on the Mac itself", async () => {
    const cloud = new FakeCloud();
    const mac = await bootMac(cloud);
    await signInMac(mac);
    const { thread } = await mac.client.threads.create({});
    await mac.client.threads.send({ text: "typed here", threadId: thread.id });
    const asked = raiseApproval(mac, thread.id);

    await mac.client.cloud.syncNow();

    expect(cloud.openApprovals()).toEqual([]);
    expect(cloud.requests).not.toContain(`POST ${DISPATCH_API_PATHS.approval}`);
    expect(getPendingInteraction(mac.db, asked.id)?.relay).toBeNull();
  });
});
