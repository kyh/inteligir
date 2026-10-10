import { hexFromBytes } from "@repo/contract/cloud/bytes";
import {
  ackDispatchesResponseSchema,
  claimDispatchesResponseSchema,
  closeApprovalResponseSchema,
  createDispatchResponseSchema,
  DISPATCH_API_PATHS,
  dispatchStatusResponseSchema,
  openApprovalResponseSchema,
} from "@repo/contract/cloud/dispatch/dispatch-schema";
import type {
  AckDispatchesRequest,
  CreateDispatchRequest,
  OpenApprovalRequest,
} from "@repo/contract/cloud/dispatch/dispatch-schema";
import { cloudErrorSchema } from "@repo/contract/cloud/errors";
import {
  SYNC_WS_PHONE_REQUESTS_ON,
  SYNC_WS_PHONE_REQUESTS_PARAM,
} from "@repo/contract/cloud/sync/sync-ws";
import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { threadSyncStub } from "../sync/routes";
import {
  awaitFrames,
  deviceHeaders,
  emitted,
  loginDevice,
  openSocket,
  ORIGIN,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";

const mintId = (): string => hexFromBytes(crypto.getRandomValues(new Uint8Array(16)));

// what a Mac that takes a phone's requests says on its upgrade
const TAKES_PHONE_REQUESTS = { [SYNC_WS_PHONE_REQUESTS_PARAM]: SYNC_WS_PHONE_REQUESTS_ON };

// the body crosses as text, so a test can send what no client's type would let it
const post = async (credential: string, path: string, json: string): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}${path}`, {
    body: json,
    headers: { ...deviceHeaders(credential), "content-type": "application/json" },
    method: "POST",
  });

const answered = async <TSchema extends z.ZodType>(
  schema: TSchema,
  response: Response,
): Promise<z.infer<TSchema>> => {
  expect(response.status).toBe(200);
  return emitted(schema, await response.text());
};

const refusal = async (response: Response) => ({
  code: emitted(cloudErrorSchema, await response.text()).error.code,
  status: response.status,
});

const create = async (credential: string, request: CreateDispatchRequest) =>
  await answered(
    createDispatchResponseSchema,
    await post(credential, DISPATCH_API_PATHS.dispatch, JSON.stringify(request)),
  );

const claim = async (credential: string) =>
  await answered(
    claimDispatchesResponseSchema,
    await post(credential, DISPATCH_API_PATHS.claim, "{}"),
  );

const claimedRows = async (credential: string) => {
  const claimed = await claim(credential);
  return claimed.dispatches;
};

const ack = async (credential: string, request: AckDispatchesRequest) =>
  await answered(
    ackDispatchesResponseSchema,
    await post(credential, DISPATCH_API_PATHS.ack, JSON.stringify(request)),
  );

const status = async (credential: string, ids: string[]) =>
  await answered(
    dispatchStatusResponseSchema,
    await post(credential, DISPATCH_API_PATHS.status, JSON.stringify({ ids })),
  );

const statesOf = async (credential: string, ids: string[]) => {
  const answer = await status(credential, ids);
  return answer.dispatches;
};

const openApproval = async (credential: string, request: OpenApprovalRequest) =>
  await answered(
    openApprovalResponseSchema,
    await post(credential, DISPATCH_API_PATHS.approval, JSON.stringify(request)),
  );

const closeApproval = async (credential: string, id: string) =>
  await answered(
    closeApprovalResponseSchema,
    await post(credential, DISPATCH_API_PATHS.approvalClose, JSON.stringify({ id })),
  );

const turn = (threadId: string, text: string): CreateDispatchRequest => ({
  id: mintId(),
  kind: "turn",
  text,
  threadId,
});

const approvalOn = (threadId: string): OpenApprovalRequest => ({
  id: mintId(),
  payload: {
    availableDecisions: ["allow_once", "deny"],
    kind: "approval",
    reason: "The agent wants to run a command.",
    subject: { command: "make notes", cwd: null, itemId: "item_1", kind: "command" },
  },
  threadId,
  turnId: "turn_1",
});

// a phone, the Mac it asks, and a second Mac that may race it, on one account
const account = async (email: string) => {
  const { bearer, password } = await signUpUser(email);
  const phone = await loginDevice(bearer, "Phone");
  const mac = await loginDevice(bearer, "Mac");
  const otherMac = await loginDevice(bearer, "Other Mac");
  const stub = threadSyncStub(env, await userIdOf(bearer));
  return { bearer, mac, otherMac, password, phone, stub };
};

describe("a phone's turn", () => {
  it("stores a resent turn once and pings for it once", async () => {
    const { mac, phone } = await account("dispatch-resend@example.test");
    const macWs = await openSocket(mac.credential, "desktop", TAKES_PHONE_REQUESTS);
    const request = turn("thr_resend", "draft a reply");

    await create(phone.credential, request);
    expect(await create(phone.credential, request)).toEqual({
      dispatch: { id: request.id, state: "waiting" },
      duplicate: true,
    });
    await create(phone.credential, turn("thr_second", "and another"));

    await awaitFrames(macWs, [
      { threadId: "thr_resend", type: "dispatch" },
      { threadId: "thr_second", type: "dispatch" },
    ]);
    expect(await claimedRows(mac.credential)).toHaveLength(2);
    macWs.socket.close();
  });

  it("pings the Macs that take a phone's requests alone, never the phone's own or another kind", async () => {
    const { bearer, mac, otherMac, phone } = await account("dispatch-audience@example.test");
    const tablet = await loginDevice(bearer, "Tablet");
    const macWs = await openSocket(mac.credential, "desktop", TAKES_PHONE_REQUESTS);
    const quietMacWs = await openSocket(otherMac.credential, "desktop");
    const tabletWs = await openSocket(tablet.credential, "other", TAKES_PHONE_REQUESTS);
    const phoneWs = await openSocket(phone.credential, "mobile");

    await create(phone.credential, turn("thr_audience", "plan the trip"));
    await awaitFrames(macWs, [{ threadId: "thr_audience", type: "dispatch" }]);

    // a later sync frame: the dispatch frame, had it been sent, would sit before it
    await post(
      phone.credential,
      "/v1/sync/push",
      JSON.stringify({
        events: [{ createdAt: 1, deviceSeq: 1, event: { type: "test" }, threadId: "thr_audience" }],
      }),
    );
    await awaitFrames(tabletWs, [{ seq: 1, type: "sync" }]);
    await awaitFrames(quietMacWs, [{ seq: 1, type: "sync" }]);
    expect(phoneWs.frames).toEqual([]);

    macWs.socket.close();
    quietMacWs.socket.close();
    tabletWs.socket.close();
    phoneWs.socket.close();
  });

  it("walks waiting, claimed and delivered or refused, and counts the Macs listening and declining", async () => {
    const { mac, otherMac, phone } = await account("dispatch-status@example.test");
    const done = turn("thr_status", "rename the draft");
    const refused = turn("thr_archived", "reopen this");
    const never = mintId();
    await create(phone.credential, done);
    await create(phone.credential, refused);

    expect(await status(phone.credential, [done.id, refused.id, never])).toEqual({
      desktopsDeclining: 0,
      desktopsOnline: 0,
      dispatches: [
        { id: done.id, state: "waiting" },
        { id: refused.id, state: "waiting" },
        { id: never, state: "unknown" },
      ],
    });

    // a Mac whose person turned phone requests off is open, and would never claim one
    const quietMacWs = await openSocket(otherMac.credential, "desktop");
    expect(await status(phone.credential, [done.id])).toMatchObject({
      desktopsDeclining: 1,
      desktopsOnline: 0,
    });

    const macWs = await openSocket(mac.credential, "desktop", TAKES_PHONE_REQUESTS);
    const claimed = await claim(mac.credential);
    expect(await status(phone.credential, [done.id])).toEqual({
      desktopsDeclining: 1,
      desktopsOnline: 1,
      dispatches: [{ id: done.id, state: "claimed" }],
    });

    await ack(mac.credential, {
      claimToken: claimed.claimToken,
      results: [
        { id: done.id, outcome: "delivered" },
        { id: refused.id, message: "That conversation is archived.", outcome: "refused" },
      ],
    });
    expect(await status(phone.credential, [done.id, refused.id])).toEqual({
      desktopsDeclining: 1,
      desktopsOnline: 1,
      dispatches: [
        { id: done.id, state: "delivered" },
        { id: refused.id, message: "That conversation is archived.", state: "refused" },
      ],
    });
    macWs.socket.close();
    quietMacWs.socket.close();
  });

  it("counts a Mac by what its upgrade's query says, never by a header it sent", async () => {
    const { mac, phone } = await account("dispatch-forged@example.test");
    const response = await SELF.fetch(`${ORIGIN}/v1/sync/ws?platform=desktop`, {
      headers: {
        ...deviceHeaders(mac.credential),
        upgrade: "websocket",
        "x-device-phone-requests": SYNC_WS_PHONE_REQUESTS_ON,
      },
    });
    const socket = response.webSocket;
    if (socket === null) {
      throw new Error("no websocket on the 101");
    }
    socket.accept();

    expect(await status(phone.credential, [mintId()])).toMatchObject({ desktopsOnline: 0 });
    socket.close();
  });

  it("refuses a turn it cannot read exactly", async () => {
    const { phone } = await account("dispatch-malformed@example.test");
    const malformed = [
      { ...turn("thr_bad", "hello"), id: "not-hex" },
      { ...turn("thr_bad", "hello"), originDocPath: "notes//Week.md" },
      { ...turn("thr_bad", "hello"), extra: true },
      { ...turn("thr_bad", "") },
    ];
    for (const body of malformed) {
      const response = await post(
        phone.credential,
        DISPATCH_API_PATHS.dispatch,
        JSON.stringify(body),
      );
      expect(await refusal(response)).toEqual({ code: "bad-request", status: 400 });
    }
  });

  it("prunes a settled row a day on, at the next create", async () => {
    const { mac, phone, stub } = await account("dispatch-prune@example.test");
    const old = turn("thr_old", "long done");
    await create(phone.credential, old);
    const claimed = await claim(mac.credential);
    await ack(mac.credential, {
      claimToken: claimed.claimToken,
      results: [{ id: old.id, outcome: "delivered" }],
    });
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE dispatches SET settled_at = 0");
    });
    expect(await statesOf(phone.credential, [old.id])).toEqual([
      { id: old.id, state: "delivered" },
    ]);

    await create(phone.credential, turn("thr_new", "fresh"));
    expect(await statesOf(phone.credential, [old.id])).toEqual([{ id: old.id, state: "unknown" }]);
  });
});

describe("an approval asked on the phone", () => {
  it("pings the phone once as it opens, and only the Mac that asked as it is answered", async () => {
    const { mac, otherMac, phone } = await account("approval-pings@example.test");
    const phoneWs = await openSocket(phone.credential, "mobile");
    const macWs = await openSocket(mac.credential, "desktop");
    const otherWs = await openSocket(otherMac.credential, "desktop");
    const approval = approvalOn("thr_ask");

    await openApproval(mac.credential, approval);
    await openApproval(mac.credential, approval);
    await awaitFrames(phoneWs, [{ threadId: "thr_ask", type: "dispatch" }]);

    await create(phone.credential, {
      approvalId: approval.id,
      decision: "allow_once",
      id: mintId(),
      kind: "answer",
    });
    await awaitFrames(macWs, [{ threadId: "thr_ask", type: "dispatch" }]);
    // an answer is for the Mac that asked: the other heard nothing
    expect(otherWs.frames).toEqual([]);

    phoneWs.socket.close();
    macWs.socket.close();
    otherWs.socket.close();
  });

  it("prunes a closed approval a day on, at the next open", async () => {
    const { mac, stub } = await account("approval-prune@example.test");
    const old = approvalOn("thr_old");
    await openApproval(mac.credential, old);
    await closeApproval(mac.credential, old.id);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE dispatch_approvals SET closed_at = 0");
    });

    await openApproval(mac.credential, approvalOn("thr_new"));
    const left = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ id: string }>("SELECT id FROM dispatch_approvals")
        .toArray()
        .map((row) => row.id),
    );
    expect(left).not.toContain(old.id);
  });
});

describe("a deleted account's dispatch inbox", () => {
  it("refuses every route with account-deleted", async () => {
    const { password, bearer, mac, phone, stub } = await account("dispatch-deleted@example.test");
    const approval = approvalOn("thr_doomed");
    await openApproval(mac.credential, approval);
    await create(phone.credential, turn("thr_doomed", "never runs"));

    const deletion = await SELF.fetch(`${ORIGIN}/api/auth/delete-user`, {
      body: JSON.stringify({ password }),
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      method: "POST",
    });
    expect(deletion.status).toBe(200);

    // replays calls whose credential check passed before the purge, as the Worker would have made them
    const late = [
      await stub.createDispatch(phone.deviceId, turn("thr_doomed", "after the purge")),
      await stub.claimDispatches(mac.deviceId, { limit: 10 }),
      await stub.ackDispatches({
        claimToken: "late-claim",
        results: [{ id: mintId(), outcome: "delivered" }],
      }),
      await stub.dispatchStatus({ ids: [mintId()] }),
      await stub.cancelDispatch({ id: mintId() }),
      await stub.openApproval(mac.deviceId, approvalOn("thr_doomed")),
      await stub.closeApproval(mac.deviceId, { id: approval.id }),
      await stub.listApprovals(),
    ];
    expect(late.map((result) => (result.ok ? "answered" : result.code))).toEqual(
      Array.from({ length: late.length }, () => "account-deleted"),
    );

    const remaining = await runInDurableObject(stub, (_instance, state) => ({
      approvals: state.storage.sql.exec("SELECT COUNT(*) AS n FROM dispatch_approvals").one().n,
      dispatches: state.storage.sql.exec("SELECT COUNT(*) AS n FROM dispatches").one().n,
    }));
    expect(remaining).toEqual({ approvals: 0, dispatches: 0 });
  });
});
