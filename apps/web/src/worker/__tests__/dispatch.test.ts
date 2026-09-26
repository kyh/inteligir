import { hexFromBytes } from "@repo/api/cloud/bytes";
import {
  ackDispatchesResponseSchema,
  cancelDispatchResponseSchema,
  claimDispatchesResponseSchema,
  closeApprovalResponseSchema,
  createDispatchResponseSchema,
  DISPATCH_API_PATHS,
  DISPATCH_MAX_PENDING,
  dispatchStatusResponseSchema,
  listApprovalsResponseSchema,
  openApprovalResponseSchema,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import type {
  AckDispatchesRequest,
  CreateDispatchRequest,
  OpenApprovalRequest,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import {
  SYNC_WS_PHONE_REQUESTS_ON,
  SYNC_WS_PHONE_REQUESTS_PARAM,
} from "@repo/api/cloud/sync/sync-ws";
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

const cancel = async (credential: string, id: string) =>
  await answered(
    cancelDispatchResponseSchema,
    await post(credential, DISPATCH_API_PATHS.cancel, JSON.stringify({ id })),
  );

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

const listApprovals = async (credential: string) =>
  await answered(
    listApprovalsResponseSchema,
    await SELF.fetch(`${ORIGIN}${DISPATCH_API_PATHS.approvals}`, {
      headers: deviceHeaders(credential),
    }),
  );

const approvalsOf = async (credential: string) => {
  const listed = await listApprovals(credential);
  return listed.approvals;
};

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

const revoke = async (bearer: string, deviceId: string): Promise<void> => {
  const response = await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
    body: JSON.stringify({ deviceId }),
    headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
};

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
  it("hands the turn, exactly as sent, to one of two Macs claiming at once", async () => {
    const { mac, otherMac, phone } = await account("dispatch-once@example.test");
    const request: CreateDispatchRequest = {
      id: mintId(),
      kind: "turn",
      originDocPath: "notes/Week.md",
      text: "summarise this week",
      threadId: "thr_phone1",
      viewContext: { resource: "notes/Week.md", revision: "c".repeat(64), surface: "doc" },
    };
    expect(await create(phone.credential, request)).toEqual({
      dispatch: { id: request.id, state: "waiting" },
      duplicate: false,
    });

    const claims = await Promise.all([claim(mac.credential), claim(otherMac.credential)]);
    const won = claims.flatMap((claimed) => claimed.dispatches);
    expect(won).toEqual([{ ...request, createdAt: expect.any(Number) }]);
  });

  it("hands a thread's turns over in the order the phone sent them", async () => {
    const { mac, phone } = await account("dispatch-order@example.test");
    // ids that sort against the send order, so only insertion order can pass
    const sent = ["f", "e", "d"].map((digit, index): CreateDispatchRequest => ({
      id: digit.repeat(32),
      kind: "turn",
      text: `step ${index + 1}`,
      threadId: "thr_order",
    }));
    for (const request of sent) {
      await create(phone.credential, request);
    }
    const claimed = await claimedRows(mac.credential);
    expect(claimed.map((row) => row.id)).toEqual(sent.map((request) => request.id));
  });

  it("lets a lapsed claim be taken again, and tells its late ack so", async () => {
    const { mac, otherMac, phone, stub } = await account("dispatch-lapsed@example.test");
    const request = turn("thr_lapsed", "tidy my inbox");
    await create(phone.credential, request);

    const stale = await claim(mac.credential);
    expect(stale.dispatches.map((row) => row.id)).toEqual([request.id]);
    expect(await claimedRows(otherMac.credential)).toEqual([]);

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE dispatches SET claimed_at = 0");
    });
    expect(await statesOf(phone.credential, [request.id])).toEqual([
      { id: request.id, state: "waiting" },
    ]);
    const fresh = await claim(otherMac.credential);
    expect(fresh.dispatches.map((row) => row.id)).toEqual([request.id]);

    const delivered: AckDispatchesRequest["results"] = [{ id: request.id, outcome: "delivered" }];
    expect(await ack(mac.credential, { claimToken: stale.claimToken, results: delivered })).toEqual(
      { results: [{ id: request.id, outcome: "reclaimed" }] },
    );
    expect(
      await ack(otherMac.credential, { claimToken: fresh.claimToken, results: delivered }),
    ).toEqual({ results: [{ id: request.id, outcome: "recorded" }] });
    expect(
      await ack(otherMac.credential, { claimToken: fresh.claimToken, results: delivered }),
    ).toEqual({ results: [{ id: request.id, outcome: "recorded" }] });
  });

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

  it("cancels a row no Mac holds, and says so for one a Mac does", async () => {
    const { mac, phone } = await account("dispatch-cancel@example.test");
    const held = turn("thr_held", "first");
    await create(phone.credential, held);
    const claimed = await claim(mac.credential);
    const waiting = turn("thr_waiting", "second");
    await create(phone.credential, waiting);

    expect(await cancel(phone.credential, waiting.id)).toEqual({ outcome: "cancelled" });
    expect(await statesOf(phone.credential, [waiting.id])).toEqual([
      { id: waiting.id, state: "unknown" },
    ]);
    expect(await cancel(phone.credential, held.id)).toEqual({ outcome: "claimed" });

    await ack(mac.credential, {
      claimToken: claimed.claimToken,
      results: [{ id: held.id, outcome: "delivered" }],
    });
    expect(await cancel(phone.credential, held.id)).toEqual({ outcome: "settled" });
    expect(await cancel(phone.credential, mintId())).toEqual({ outcome: "unknown" });
    expect(await claimedRows(mac.credential)).toEqual([]);
  });

  it("drops a revoked phone's waiting turns, and leaves the one a Mac already holds", async () => {
    const { bearer, mac, phone } = await account("dispatch-revoke@example.test");
    const held = turn("thr_held", "already on its way");
    await create(phone.credential, held);
    await claim(mac.credential);
    const waiting = turn("thr_lost", "from a lost phone");
    await create(phone.credential, waiting);

    await revoke(bearer, phone.deviceId);

    expect(await statesOf(mac.credential, [held.id, waiting.id])).toEqual([
      { id: held.id, state: "claimed" },
      { id: waiting.id, state: "unknown" },
    ]);
  });

  it("refuses a turn past the account's pending cap as rate-limited", async () => {
    const { phone, stub } = await account("dispatch-cap@example.test");
    for (let index = 0; index < DISPATCH_MAX_PENDING; index += 1) {
      const stored = await stub.createDispatch(phone.deviceId, turn("thr_cap", `ask ${index}`));
      expect(stored.ok).toBe(true);
    }
    const response = await post(
      phone.credential,
      DISPATCH_API_PATHS.dispatch,
      JSON.stringify(turn("thr_cap", "one more")),
    );
    expect(await refusal(response)).toEqual({ code: "rate-limited", status: 429 });
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
  it("reaches the phone, and the phone's answer reaches only the Mac that asked", async () => {
    const { mac, otherMac, phone } = await account("approval-flow@example.test");
    const phoneWs = await openSocket(phone.credential, "mobile");
    const macWs = await openSocket(mac.credential, "desktop");
    const otherWs = await openSocket(otherMac.credential, "desktop");
    const approval = approvalOn("thr_ask");

    expect(await openApproval(mac.credential, approval)).toEqual({
      duplicate: false,
      state: "open",
    });
    expect(await openApproval(mac.credential, approval)).toEqual({
      duplicate: true,
      state: "open",
    });
    await awaitFrames(phoneWs, [{ threadId: "thr_ask", type: "dispatch" }]);
    expect(await listApprovals(phone.credential)).toEqual({
      approvals: [
        {
          createdAt: expect.any(Number),
          id: approval.id,
          payload: approval.payload,
          state: "open",
          threadId: "thr_ask",
          turnId: "turn_1",
        },
      ],
    });

    const unoffered = await post(
      phone.credential,
      DISPATCH_API_PATHS.dispatch,
      JSON.stringify({
        approvalId: approval.id,
        decision: "allow_for_session",
        id: mintId(),
        kind: "answer",
      }),
    );
    expect(await refusal(unoffered)).toEqual({ code: "bad-request", status: 400 });

    const answer: CreateDispatchRequest = {
      approvalId: approval.id,
      decision: "allow_once",
      id: mintId(),
      kind: "answer",
    };
    expect(await create(phone.credential, answer)).toEqual({
      dispatch: { id: answer.id, state: "waiting" },
      duplicate: false,
    });
    await awaitFrames(macWs, [{ threadId: "thr_ask", type: "dispatch" }]);
    const listed = await approvalsOf(phone.credential);
    expect(listed.map((row) => row.state)).toEqual(["answered"]);

    const late = await create(phone.credential, { ...answer, decision: "deny", id: mintId() });
    expect(late.dispatch).toEqual({
      id: late.dispatch.id,
      message: "That request was already answered.",
      state: "refused",
    });

    expect(await claimedRows(otherMac.credential)).toEqual([]);
    const claimed = await claim(mac.credential);
    expect(claimed.dispatches).toEqual([
      { ...answer, createdAt: expect.any(Number), threadId: "thr_ask" },
    ]);
    await ack(mac.credential, {
      claimToken: claimed.claimToken,
      results: [{ id: answer.id, outcome: "delivered" }],
    });
    expect(await listApprovals(phone.credential)).toEqual({ approvals: [] });
    expect(await statesOf(phone.credential, [answer.id])).toEqual([
      { id: answer.id, state: "delivered" },
    ]);

    const afterClose = await create(phone.credential, { ...answer, id: mintId() });
    expect(afterClose.dispatch).toMatchObject({
      message: "That request is no longer waiting.",
      state: "refused",
    });
    // an answer is for the Mac that asked: the other heard nothing
    expect(otherWs.frames).toEqual([]);

    phoneWs.socket.close();
    macWs.socket.close();
    otherWs.socket.close();
  });

  it("refuses an answer to an approval it never held", async () => {
    const { phone } = await account("approval-unknown@example.test");
    const response = await post(
      phone.credential,
      DISPATCH_API_PATHS.dispatch,
      JSON.stringify({ approvalId: mintId(), decision: "deny", id: mintId(), kind: "answer" }),
    );
    expect(await refusal(response)).toEqual({ code: "not-found", status: 404 });
  });

  it("is closed by the Mac that opened it and no other", async () => {
    const { mac, otherMac, phone } = await account("approval-close@example.test");
    const approval = approvalOn("thr_close");
    await openApproval(mac.credential, approval);

    expect(await closeApproval(otherMac.credential, approval.id)).toEqual({ outcome: "unknown" });
    expect(await approvalsOf(phone.credential)).toHaveLength(1);
    expect(await closeApproval(mac.credential, approval.id)).toEqual({ outcome: "closed" });
    expect(await closeApproval(mac.credential, approval.id)).toEqual({ outcome: "closed" });
    expect(await listApprovals(phone.credential)).toEqual({ approvals: [] });
    expect(await openApproval(mac.credential, approval)).toEqual({
      duplicate: true,
      state: "closed",
    });
  });

  it("opens again when the answer is withdrawn before its Mac held it", async () => {
    const { mac, phone } = await account("approval-withdraw@example.test");
    const approval = approvalOn("thr_withdraw");
    await openApproval(mac.credential, approval);
    const answer: CreateDispatchRequest = {
      approvalId: approval.id,
      decision: "deny",
      id: mintId(),
      kind: "answer",
    };
    await create(phone.credential, answer);

    expect(await cancel(phone.credential, answer.id)).toEqual({ outcome: "cancelled" });
    const listed = await approvalsOf(phone.credential);
    expect(listed.map((row) => row.state)).toEqual(["open"]);
  });

  it("closes a revoked Mac's approvals and refuses the answers waiting for it", async () => {
    const { bearer, mac, phone } = await account("approval-revoke@example.test");
    const approval = approvalOn("thr_gone");
    await openApproval(mac.credential, approval);
    const answer: CreateDispatchRequest = {
      approvalId: approval.id,
      decision: "allow_once",
      id: mintId(),
      kind: "answer",
    };
    await create(phone.credential, answer);

    await revoke(bearer, mac.deviceId);

    expect(await listApprovals(phone.credential)).toEqual({ approvals: [] });
    expect(await statesOf(phone.credential, [answer.id])).toEqual([
      { id: answer.id, message: "That computer was signed out.", state: "refused" },
    ]);
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
