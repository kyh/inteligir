// The account inboxes' refusal and ordering rules as one table, every row driven through the
// client the local server and the phone run. The CLI's suites run it against their fake cloud
// (apps/cli/src/server/cloud/__tests__/inbox-scenarios.test.ts) and the Worker's against the real
// object (apps/web/src/worker/__tests__/inbox-scenarios.test.ts), so a rule the fake gets wrong
// fails beside the run that pins it. A row observes ids, states and texts, never a clock or a
// token, and leaves out what only one side can show: sockets, pruning, a body no client sends.

import { describeCloudFailure } from "../cloud-client";
import type { CloudClient, CloudResult } from "../cloud-client";
import {
  APPROVAL_MAX_OPEN,
  DISPATCH_CLAIM_DEFAULT_LIMIT,
  DISPATCH_MAX_PENDING,
  dispatchKindSchema,
} from "../dispatch/dispatch-schema";
import type {
  AckDispatchesRequest,
  ApprovalRow,
  ClaimedDispatch,
  CreateDispatchRequest,
  DispatchKind,
  OpenApprovalRequest,
} from "../dispatch/dispatch-schema";

export interface InboxDevice {
  client: CloudClient;
  deviceId: string;
}

export interface InboxCloud {
  // another device signed in to the row's own fresh account
  signIn: (name: string) => Promise<InboxDevice>;
  // every claim, as if its ttl ran out
  lapseClaims: () => Promise<void>;
}

// what a row observes: plain data, compared whole; undefined is a wire row's absent optional field
export type Observed =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Observed[]
  | { readonly [key: string]: Observed };

export interface InboxScenario {
  readonly name: string;
  readonly run: (cloud: InboxCloud) => Promise<Observed>;
  readonly expected: Observed;
}

// typed at the row, so what a run observes and what the row expects are one shape
const scenario = <TObserved extends Observed>(
  name: string,
  run: (cloud: InboxCloud) => Promise<TObserved>,
  expected: TObserved,
): InboxScenario => ({ expected, name, run });

const answered = <TValue>(result: CloudResult<TValue>): TValue => {
  if (!result.ok) {
    throw new Error(`the cloud did not answer: ${describeCloudFailure(result.failure)}`);
  }
  return result.value;
};

// a refusal's code, or the kind of a failure that is none; an answer reads `answered`
const verdictOf = <TValue>(result: CloudResult<TValue>): string => {
  if (result.ok) {
    return "answered";
  }
  return result.failure.kind === "refused" ? result.failure.code : result.failure.kind;
};

const dispatchId = (n: number): string => n.toString(16).padStart(32, "0");

type TurnRequest = Extract<CreateDispatchRequest, { kind: "turn" }>;
type Decision = Extract<CreateDispatchRequest, { kind: "answer" }>["decision"];

const turn = (id: string, threadId: string, text: string): TurnRequest => ({
  id,
  kind: "turn",
  text,
  threadId,
});

const answer = (id: string, approvalId: string, decision: Decision): CreateDispatchRequest => ({
  approvalId,
  decision,
  id,
  kind: "answer",
});

const capture = (id: string, text: string): CreateDispatchRequest => ({
  id,
  kind: "capture",
  text,
});

const PAYLOAD: OpenApprovalRequest["payload"] = {
  availableDecisions: ["allow_once", "deny"],
  kind: "approval",
  reason: "The agent wants to run a command.",
  subject: { command: "make notes", cwd: null, itemId: "item_1", kind: "command" },
};

const approval = (id: string, threadId: string): OpenApprovalRequest => ({
  id,
  payload: PAYLOAD,
  threadId,
  turnId: "turn_1",
});

const ids = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

// a claimed row, its clock read only as whether the cloud stamped one
const stamped = (row: ClaimedDispatch) => ({ ...row, createdAt: row.createdAt > 0 });

const listedOf = (rows: readonly ApprovalRow[]) =>
  rows.map((row) => ({
    id: row.id,
    payload: row.payload,
    state: row.state,
    threadId: row.threadId,
    turnId: row.turnId,
  }));

const EVERY_KIND: DispatchKind[] = [...dispatchKindSchema.options];

const claimKinds = async (device: InboxDevice, kinds: DispatchKind[]) =>
  answered(await device.client.claimDispatches({ kinds, limit: DISPATCH_CLAIM_DEFAULT_LIMIT }));

const claimTurns = async (device: InboxDevice) => await claimKinds(device, EVERY_KIND);

const claimedIds = async (device: InboxDevice): Promise<string[]> => {
  const claimed = await claimTurns(device);
  return ids(claimed.dispatches);
};

const statesOf = async (device: InboxDevice, of: readonly string[]) =>
  answered(await device.client.dispatchStatus(of)).dispatches;

const approvalsOf = async (device: InboxDevice) =>
  answered(await device.client.listApprovals()).approvals;

const approvalStates = async (device: InboxDevice) => {
  const listed = await approvalsOf(device);
  return listed.map((row) => row.state);
};

const WEEK: TurnRequest = {
  id: dispatchId(1),
  kind: "turn",
  originDocPath: "notes/Week.md",
  text: "summarise this week",
  threadId: "thr_week",
  viewContext: { resource: "notes/Week.md", revision: "c".repeat(64), surface: "doc" },
};

const ARCHIVED = "That conversation is archived.";
const ALREADY_ANSWERED = "That request was already answered.";
const NO_LONGER_WAITING = "That request is no longer waiting.";
const SIGNED_OUT = "That computer was signed out.";

const TURN_SCENARIOS: readonly InboxScenario[] = [
  scenario(
    "hands a turn, exactly as sent, to one of two Macs claiming at once",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const otherMac = await signIn("Other Mac");
      const created = answered(await phone.client.createDispatch(WEEK));
      const claims = await Promise.all([claimTurns(mac), claimTurns(otherMac)]);
      return { created, handed: claims.flatMap((claim) => claim.dispatches).map(stamped) };
    },
    {
      created: { dispatch: { id: WEEK.id, state: "waiting" }, duplicate: false },
      handed: [{ ...WEEK, createdAt: true }],
    },
  ),
  scenario(
    "hands a thread's turns over in the order the phone sent them",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      // ids that sort against the send order, so only arrival order can pass
      for (const [index, digit] of ["f", "e", "d"].entries()) {
        answered(
          await phone.client.createDispatch(
            turn(digit.repeat(32), "thr_order", `step ${index + 1}`),
          ),
        );
      }
      return await claimedIds(mac);
    },
    ["f".repeat(32), "e".repeat(32), "d".repeat(32)],
  ),
  scenario(
    "stores a resent turn once",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const request = turn(dispatchId(1), "thr_resend", "draft a reply");
      const first = answered(await phone.client.createDispatch(request));
      const again = answered(await phone.client.createDispatch(request));
      return { again, claimed: await claimedIds(mac), first };
    },
    {
      again: { dispatch: { id: dispatchId(1), state: "waiting" }, duplicate: true },
      claimed: [dispatchId(1)],
      first: { dispatch: { id: dispatchId(1), state: "waiting" }, duplicate: false },
    },
  ),
  scenario(
    "lets a lapsed claim be taken again, and tells its late ack so",
    async ({ lapseClaims, signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const otherMac = await signIn("Other Mac");
      const request = turn(dispatchId(1), "thr_lapsed", "tidy my inbox");
      answered(await phone.client.createDispatch(request));
      const stale = await claimTurns(mac);
      const heldElsewhere = await claimedIds(otherMac);
      await lapseClaims();
      const afterLapse = await statesOf(phone, [request.id]);
      const fresh = await claimTurns(otherMac);
      const delivered: AckDispatchesRequest["results"] = [{ id: request.id, outcome: "delivered" }];
      const late = answered(
        await mac.client.ackDispatches({ claimToken: stale.claimToken, results: delivered }),
      );
      const settled = answered(
        await otherMac.client.ackDispatches({ claimToken: fresh.claimToken, results: delivered }),
      );
      const replayed = answered(
        await otherMac.client.ackDispatches({ claimToken: fresh.claimToken, results: delivered }),
      );
      return {
        afterLapse,
        fresh: ids(fresh.dispatches),
        heldElsewhere,
        late: late.results,
        replayed: replayed.results,
        settled: settled.results,
        stale: ids(stale.dispatches),
        status: await statesOf(phone, [request.id]),
      };
    },
    {
      afterLapse: [{ id: dispatchId(1), state: "waiting" }],
      fresh: [dispatchId(1)],
      heldElsewhere: [],
      late: [{ id: dispatchId(1), outcome: "reclaimed" }],
      replayed: [{ id: dispatchId(1), outcome: "recorded" }],
      settled: [{ id: dispatchId(1), outcome: "recorded" }],
      stale: [dispatchId(1)],
      status: [{ id: dispatchId(1), state: "delivered" }],
    },
  ),
  scenario(
    "walks a row through waiting and claimed to delivered or refused",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const done = turn(dispatchId(1), "thr_status", "rename the draft");
      const refused = turn(dispatchId(2), "thr_archived", "reopen this");
      answered(await phone.client.createDispatch(done));
      answered(await phone.client.createDispatch(refused));
      const before = await statesOf(phone, [done.id, refused.id, dispatchId(3)]);
      const claimed = await claimTurns(mac);
      const held = await statesOf(phone, [done.id]);
      answered(
        await mac.client.ackDispatches({
          claimToken: claimed.claimToken,
          results: [
            { id: done.id, outcome: "delivered" },
            { id: refused.id, message: ARCHIVED, outcome: "refused" },
          ],
        }),
      );
      return { after: await statesOf(phone, [done.id, refused.id]), before, held };
    },
    {
      after: [
        { id: dispatchId(1), state: "delivered" },
        { id: dispatchId(2), message: ARCHIVED, state: "refused" },
      ],
      before: [
        { id: dispatchId(1), state: "waiting" },
        { id: dispatchId(2), state: "waiting" },
        { id: dispatchId(3), state: "unknown" },
      ],
      held: [{ id: dispatchId(1), state: "claimed" }],
    },
  ),
  scenario(
    "cancels a row no Mac holds, and says so for one a Mac holds or settled",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const held = turn(dispatchId(1), "thr_held", "first");
      answered(await phone.client.createDispatch(held));
      const claimed = await claimTurns(mac);
      const waiting = turn(dispatchId(2), "thr_waiting", "second");
      answered(await phone.client.createDispatch(waiting));
      const cancelled = answered(await phone.client.cancelDispatch(waiting.id));
      const gone = await statesOf(phone, [waiting.id]);
      const whileHeld = answered(await phone.client.cancelDispatch(held.id));
      answered(
        await mac.client.ackDispatches({
          claimToken: claimed.claimToken,
          results: [{ id: held.id, outcome: "delivered" }],
        }),
      );
      return {
        afterSettle: answered(await phone.client.cancelDispatch(held.id)),
        cancelled,
        gone,
        left: await claimedIds(mac),
        neverSent: answered(await phone.client.cancelDispatch(dispatchId(3))),
        whileHeld,
      };
    },
    {
      afterSettle: { outcome: "settled" },
      cancelled: { outcome: "cancelled" },
      gone: [{ id: dispatchId(2), state: "unknown" }],
      left: [],
      neverSent: { outcome: "unknown" },
      whileHeld: { outcome: "claimed" },
    },
  ),
  scenario(
    "refuses a turn past the account's pending cap, and makes room as one settles",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      for (let n = 1; n <= DISPATCH_MAX_PENDING; n += 1) {
        answered(await phone.client.createDispatch(turn(dispatchId(n), "thr_cap", `ask ${n}`)));
      }
      const over = turn(dispatchId(DISPATCH_MAX_PENDING + 1), "thr_cap", "one more");
      const refused = verdictOf(await phone.client.createDispatch(over));
      const resent = answered(
        await phone.client.createDispatch(turn(dispatchId(1), "thr_cap", "ask 1")),
      );
      const claimed = answered(await mac.client.claimDispatches({ kinds: EVERY_KIND, limit: 1 }));
      answered(
        await mac.client.ackDispatches({
          claimToken: claimed.claimToken,
          results: [{ id: dispatchId(1), outcome: "delivered" }],
        }),
      );
      return {
        afterSettle: verdictOf(await phone.client.createDispatch(over)),
        refused,
        resent: resent.duplicate,
      };
    },
    { afterSettle: "answered", refused: "rate-limited", resent: true },
  ),
  scenario(
    "drops a revoked phone's waiting turns, and leaves the one a Mac holds",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const held = turn(dispatchId(1), "thr_held", "already on its way");
      answered(await phone.client.createDispatch(held));
      await claimTurns(mac);
      const waiting = turn(dispatchId(2), "thr_lost", "from a lost phone");
      answered(await phone.client.createDispatch(waiting));
      answered(await mac.client.revokeDevice(phone.deviceId));
      return await statesOf(mac, [held.id, waiting.id]);
    },
    [
      { id: dispatchId(1), state: "claimed" },
      { id: dispatchId(2), state: "unknown" },
    ],
  ),
];

const APPROVAL_SCENARIOS: readonly InboxScenario[] = [
  scenario(
    "offers an approval to the phone, and hands its one answer to the Mac that asked",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const otherMac = await signIn("Other Mac");
      const asked = approval(dispatchId(1), "thr_ask");
      const opened = answered(await mac.client.openApproval(asked));
      const reopened = answered(await mac.client.openApproval(asked));
      const offered = listedOf(await approvalsOf(phone));
      const unoffered = verdictOf(
        await phone.client.createDispatch(answer(dispatchId(2), asked.id, "allow_for_session")),
      );
      const reply = answer(dispatchId(3), asked.id, "allow_once");
      const sent = answered(await phone.client.createDispatch(reply));
      const whileAnswered = await approvalStates(phone);
      const late = answered(
        await phone.client.createDispatch(answer(dispatchId(4), asked.id, "deny")),
      );
      const toOther = await claimedIds(otherMac);
      const claimed = await claimTurns(mac);
      const acked = answered(
        await mac.client.ackDispatches({
          claimToken: claimed.claimToken,
          results: [{ id: reply.id, outcome: "delivered" }],
        }),
      );
      const afterAck = await approvalsOf(phone);
      const status = await statesOf(phone, [reply.id]);
      const afterClose = answered(
        await phone.client.createDispatch(answer(dispatchId(5), asked.id, "allow_once")),
      );
      return {
        acked: acked.results,
        afterAck,
        afterClose: afterClose.dispatch,
        handed: claimed.dispatches.map(stamped),
        late: late.dispatch,
        offered,
        opened,
        reopened,
        sent,
        status,
        toOther,
        unoffered,
        whileAnswered,
      };
    },
    {
      acked: [{ id: dispatchId(3), outcome: "recorded" }],
      afterAck: [],
      afterClose: { id: dispatchId(5), message: NO_LONGER_WAITING, state: "refused" },
      handed: [
        {
          approvalId: dispatchId(1),
          createdAt: true,
          decision: "allow_once",
          id: dispatchId(3),
          kind: "answer",
          threadId: "thr_ask",
        },
      ],
      late: { id: dispatchId(4), message: ALREADY_ANSWERED, state: "refused" },
      offered: [
        {
          id: dispatchId(1),
          payload: PAYLOAD,
          state: "open",
          threadId: "thr_ask",
          turnId: "turn_1",
        },
      ],
      opened: { duplicate: false, state: "open" },
      reopened: { duplicate: true, state: "open" },
      sent: { dispatch: { id: dispatchId(3), state: "waiting" }, duplicate: false },
      status: [{ id: dispatchId(3), state: "delivered" }],
      toOther: [],
      unoffered: "bad-request",
      whileAnswered: ["answered"],
    },
  ),
  scenario(
    "refuses an answer to an approval it never held",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      return verdictOf(
        await phone.client.createDispatch(answer(dispatchId(2), dispatchId(1), "deny")),
      );
    },
    "not-found",
  ),
  scenario(
    "is closed by the Mac that opened it and no other",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const otherMac = await signIn("Other Mac");
      const asked = approval(dispatchId(1), "thr_close");
      answered(await mac.client.openApproval(asked));
      const byOther = answered(await otherMac.client.closeApproval(asked.id));
      const stillOffered = ids(await approvalsOf(phone));
      const closed = answered(await mac.client.closeApproval(asked.id));
      const again = answered(await mac.client.closeApproval(asked.id));
      return {
        again,
        afterClose: await approvalsOf(phone),
        byOther,
        closed,
        reopened: answered(await mac.client.openApproval(asked)),
        stillOffered,
      };
    },
    {
      afterClose: [],
      again: { outcome: "closed" },
      byOther: { outcome: "unknown" },
      closed: { outcome: "closed" },
      reopened: { duplicate: true, state: "closed" },
      stillOffered: [dispatchId(1)],
    },
  ),
  scenario(
    "refuses the answer still waiting when its Mac closes it, and leaves the one the Mac holds",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const held = approval(dispatchId(1), "thr_held");
      const waiting = approval(dispatchId(2), "thr_waiting");
      answered(await mac.client.openApproval(held));
      answered(await mac.client.openApproval(waiting));
      const heldAnswer = answer(dispatchId(3), held.id, "allow_once");
      answered(await phone.client.createDispatch(heldAnswer));
      const claimed = await claimTurns(mac);
      const waitingAnswer = answer(dispatchId(4), waiting.id, "deny");
      answered(await phone.client.createDispatch(waitingAnswer));
      answered(await mac.client.closeApproval(held.id));
      answered(await mac.client.closeApproval(waiting.id));
      const afterClose = await statesOf(phone, [waitingAnswer.id, heldAnswer.id]);
      answered(
        await mac.client.ackDispatches({
          claimToken: claimed.claimToken,
          results: [{ id: heldAnswer.id, outcome: "delivered" }],
        }),
      );
      return { afterAck: await statesOf(phone, [heldAnswer.id]), afterClose };
    },
    {
      afterAck: [{ id: dispatchId(3), state: "delivered" }],
      afterClose: [
        { id: dispatchId(4), message: NO_LONGER_WAITING, state: "refused" },
        { id: dispatchId(3), state: "claimed" },
      ],
    },
  ),
  scenario(
    "opens again when its answer is withdrawn before the Mac held it",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const asked = approval(dispatchId(1), "thr_withdraw");
      answered(await mac.client.openApproval(asked));
      answered(await phone.client.createDispatch(answer(dispatchId(2), asked.id, "deny")));
      const withdrawn = answered(await phone.client.cancelDispatch(dispatchId(2)));
      const reopened = await approvalStates(phone);
      const again = answered(
        await phone.client.createDispatch(answer(dispatchId(3), asked.id, "allow_once")),
      );
      return { again: again.dispatch, reopened, withdrawn };
    },
    {
      again: { id: dispatchId(3), state: "waiting" },
      reopened: ["open"],
      withdrawn: { outcome: "cancelled" },
    },
  ),
  scenario(
    "closes a revoked Mac's approvals, and refuses the answers waiting for it",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const asked = approval(dispatchId(1), "thr_gone");
      answered(await mac.client.openApproval(asked));
      const reply = answer(dispatchId(2), asked.id, "allow_once");
      answered(await phone.client.createDispatch(reply));
      answered(await phone.client.revokeDevice(mac.deviceId));
      return { offered: await approvalsOf(phone), status: await statesOf(phone, [reply.id]) };
    },
    {
      offered: [],
      status: [{ id: dispatchId(2), message: SIGNED_OUT, state: "refused" }],
    },
  ),
  scenario(
    "refuses an approval past the open cap, and makes room as one closes",
    async ({ signIn }) => {
      const mac = await signIn("Mac");
      for (let n = 1; n <= APPROVAL_MAX_OPEN; n += 1) {
        answered(await mac.client.openApproval(approval(dispatchId(n), "thr_cap")));
      }
      const over = approval(dispatchId(APPROVAL_MAX_OPEN + 1), "thr_cap");
      const refused = verdictOf(await mac.client.openApproval(over));
      answered(await mac.client.closeApproval(dispatchId(1)));
      return { afterClose: verdictOf(await mac.client.openApproval(over)), refused };
    },
    { afterClose: "answered", refused: "rate-limited" },
  ),
];

const CAPTURE_SCENARIOS: readonly InboxScenario[] = [
  scenario(
    "hands a capture, as sent, only to a claim that names captures, and a turn only to one that names turns",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const declining = await signIn("Declining Mac");
      answered(await phone.client.createDispatch(turn(dispatchId(1), "thr_turn", "tidy this")));
      const created = answered(
        await phone.client.createDispatch(capture(dispatchId(2), "buy oat milk")),
      );
      const toDeclining = await claimKinds(declining, ["capture"]);
      const toMac = await claimKinds(mac, ["turn", "answer"]);
      answered(
        await declining.client.ackDispatches({
          claimToken: toDeclining.claimToken,
          results: [{ id: dispatchId(2), outcome: "delivered" }],
        }),
      );
      return {
        created,
        settled: await statesOf(phone, [dispatchId(2)]),
        toDeclining: toDeclining.dispatches.map(stamped),
        toMac: ids(toMac.dispatches),
      };
    },
    {
      created: { dispatch: { id: dispatchId(2), state: "waiting" }, duplicate: false },
      settled: [{ id: dispatchId(2), state: "delivered" }],
      toDeclining: [{ createdAt: true, id: dispatchId(2), kind: "capture", text: "buy oat milk" }],
      toMac: [dispatchId(1)],
    },
  ),
  scenario(
    "stores a resent capture once, and refuses one with no words",
    async ({ signIn }) => {
      const phone = await signIn("Phone");
      const mac = await signIn("Mac");
      const request = capture(dispatchId(1), "one thought");
      const first = answered(await phone.client.createDispatch(request));
      const again = answered(await phone.client.createDispatch(request));
      return {
        blank: verdictOf(await phone.client.createDispatch(capture(dispatchId(2), "   "))),
        claimed: await claimedIds(mac),
        duplicates: [first.duplicate, again.duplicate],
      };
    },
    { blank: "bad-request", claimed: [dispatchId(1)], duplicates: [false, true] },
  ),
];

export const INBOX_SCENARIOS: readonly InboxScenario[] = [
  ...TURN_SCENARIOS,
  ...APPROVAL_SCENARIOS,
  ...CAPTURE_SCENARIOS,
];
