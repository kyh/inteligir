// the account's dispatch inbox as the phone meets it, keeping the Worker's rules that matter here:
// the id is the idempotency key, a cancel takes only a row no Mac holds, and an answer marks its
// approval answered. The Mac's side is three calls a test makes.

import type { CloudClient, CloudResult } from "@repo/api/cloud/client";
import type {
  ApprovalRow,
  CreateDispatchRequest,
  CreateDispatchResponse,
  DispatchStatus,
} from "@repo/api/cloud/dispatch/dispatch-schema";
import { ok } from "../../sync/__tests__/fakes";

interface InboxRow {
  request: CreateDispatchRequest;
  status: DispatchStatus;
}

// `drops-answers`: a request lands and its answer is lost on the way back
type InboxNetwork = "up" | "down" | "drops-answers";

export interface FakeInbox {
  client: Partial<CloudClient>;
  rows: Map<string, InboxRow>;
  // every create the phone sent, resends included
  creates: CreateDispatchRequest[];
  network: InboxNetwork;
  desktopsOnline: number;
  desktopsDeclining: number;
  // a Mac asking the phone, as the Mac holding a phone-started turn's waiter does
  openApproval: (row: ApprovalRow) => void;
  approvals: () => readonly ApprovalRow[];
  // the next create waits on this rather than being answered by the inbox
  hold: Promise<CloudResult<CreateDispatchResponse>> | null;
  claim: (id: string) => void;
  deliver: (id: string) => void;
  refuse: (id: string, message: string) => void;
}

const unreachable = <T>(): CloudResult<T> => ({
  failure: { kind: "unreachable", message: "offline" },
  ok: false,
});

export const createFakeInbox = (): FakeInbox => {
  const rows = new Map<string, InboxRow>();
  let approvals: ApprovalRow[] = [];

  const settle = (id: string, status: DispatchStatus): void => {
    const row = rows.get(id);
    if (row === undefined) {
      throw new Error(`the inbox holds no ${id}`);
    }
    rows.set(id, { ...row, status });
    const { request } = row;
    if (request.kind === "answer" && status.state !== "claimed") {
      approvals = approvals.filter((approval) => approval.id !== request.approvalId);
    }
  };

  const store = (request: CreateDispatchRequest): DispatchStatus => {
    const status: DispatchStatus = { id: request.id, state: "waiting" };
    rows.set(request.id, { request, status });
    if (request.kind === "answer") {
      approvals = approvals.map((approval) =>
        approval.id === request.approvalId ? { ...approval, state: "answered" } : approval,
      );
    }
    return status;
  };

  const inbox: FakeInbox = {
    approvals: () => approvals,
    claim: (id) => {
      settle(id, { id, state: "claimed" });
    },
    client: {
      cancelDispatch: async (id) => {
        if (inbox.network !== "up") {
          return unreachable();
        }
        const row = rows.get(id);
        if (row === undefined) {
          return ok({ outcome: "unknown" });
        }
        if (row.status.state === "waiting") {
          rows.delete(id);
          return ok({ outcome: "cancelled" });
        }
        return ok({ outcome: row.status.state === "claimed" ? "claimed" : "settled" });
      },
      createDispatch: async (request) => {
        inbox.creates.push(request);
        const { hold } = inbox;
        if (hold !== null) {
          inbox.hold = null;
          return await hold;
        }
        if (inbox.network === "down") {
          return unreachable();
        }
        const held = rows.get(request.id);
        const status = held?.status ?? store(request);
        return inbox.network === "drops-answers"
          ? unreachable()
          : ok({ dispatch: status, duplicate: held !== undefined });
      },
      dispatchStatus: async (ids) =>
        inbox.network === "up"
          ? ok({
              desktopsDeclining: inbox.desktopsDeclining,
              desktopsOnline: inbox.desktopsOnline,
              dispatches: ids.map(
                (id): DispatchStatus => rows.get(id)?.status ?? { id, state: "unknown" },
              ),
            })
          : unreachable(),
      listApprovals: async () => (inbox.network === "up" ? ok({ approvals }) : unreachable()),
    },
    creates: [],
    deliver: (id) => {
      settle(id, { id, state: "delivered" });
    },
    desktopsDeclining: 0,
    desktopsOnline: 1,
    hold: null,
    network: "up",
    openApproval: (row) => {
      approvals = [...approvals, row];
    },
    refuse: (id, message) => {
      settle(id, { id, message, state: "refused" });
    },
    rows,
  };
  return inbox;
};
