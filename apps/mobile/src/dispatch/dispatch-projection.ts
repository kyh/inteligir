// what the screens draw of the phone's requests beside the synced log: a pending message until the
// log's request carrying its id replaces it, a thread that so far exists only on this phone, and a
// Mac's question waiting on the phone's answer. Pure, so the copy and the merge run under test.

import type { ApprovalRow } from "@repo/api/cloud/dispatch/dispatch-schema";
import { answerableDecisions } from "@repo/domain/pending-interactions";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionApprovalDecision,
} from "@repo/domain/pending-interactions";
import { deriveThreadTitle } from "@repo/domain/thread-title";
import { UNTITLED_THREAD } from "../sync/thread-projection";
import type { ThreadProjection } from "../sync/thread-projection";
import type {
  AnswerDispatch,
  DesktopsOnline,
  DispatchPhase,
  DispatchState,
  TurnDispatch,
} from "./dispatch-runtime";

export const WORKING_CAPTION = "Your Mac is working…";

const ASKING_CAPTION = "Your Mac is waiting for your answer";

const WAITING_CAPTION = "Waiting for your Mac…";

// what a request waiting on no Mac says: a Mac that is open but turned phone requests off is named
// by its switch, since opening inteligir there again would change nothing
const noMacCaption = ({ declining }: DesktopsOnline): string =>
  declining > 0
    ? "Waiting for your Mac — turn on “Let my phone ask this Mac” in its Settings"
    : "Waiting for your Mac — open inteligir on it to run this";

// desktops is null before the first status poll answered, which says nothing is listening no more
// than it says something is
export const dispatchCaption = (phase: DispatchPhase, desktops: DesktopsOnline | null): string => {
  switch (phase.kind) {
    case "unsent": {
      return "Not sent yet — retrying";
    }
    case "waiting": {
      return desktops === null || desktops.listening > 0 ? WAITING_CAPTION : noMacCaption(desktops);
    }
    case "claimed":
    case "delivered": {
      return "Your Mac has it";
    }
    case "refused": {
      return phase.message;
    }
    // no default
  }
};

export const DECISION_LABELS = {
  allow_for_session: "Allow for session",
  allow_once: "Allow once",
  deny: "Deny",
} satisfies Record<PendingInteractionApprovalDecision, string>;

export interface ApprovalView {
  id: string;
  // what the agent asks to do; `code` when it is a command, drawn as written
  summary: string;
  code: boolean;
  reason: string | null;
  decisions: readonly PendingInteractionApprovalDecision[];
  // this phone's answer while it is on its way, or refused
  answer: AnswerDispatch | null;
  // answered from another phone
  answeredElsewhere: boolean;
}

const approvalSummary = (
  payload: ApprovalPendingInteractionPayload,
): Pick<ApprovalView, "summary" | "code"> => {
  const { subject } = payload;
  switch (subject.kind) {
    case "command": {
      return { code: true, summary: subject.command };
    }
    case "file_change": {
      return {
        code: false,
        summary:
          subject.writeScope === null
            ? "Apply file changes"
            : `Apply file changes in ${subject.writeScope}`,
      };
    }
    // no default
  }
};

export interface ThreadDispatches {
  // oldest first, and never one the log already holds
  pending: readonly TurnDispatch[];
  approvals: readonly ApprovalView[];
  desktops: DesktopsOnline | null;
}

const isTurn = (dispatch: DispatchState["dispatches"][number]): dispatch is TurnDispatch =>
  dispatch.kind === "turn";

const isAnswer = (dispatch: DispatchState["dispatches"][number]): dispatch is AnswerDispatch =>
  dispatch.kind === "answer";

// the filter is here as well as in the runtime, which drops a row only once its delete commits: a
// render between the pull and that commit would otherwise draw the message twice
export const threadDispatches = (
  threadId: string,
  thread: ThreadProjection | null,
  state: DispatchState,
): ThreadDispatches => {
  const answers = state.dispatches.filter(isAnswer);
  return {
    approvals: state.approvals
      .filter((approval) => approval.threadId === threadId)
      .map((approval: ApprovalRow): ApprovalView => {
        const answer =
          answers.findLast((candidate) => candidate.approvalId === approval.id) ?? null;
        return {
          ...approvalSummary(approval.payload),
          answer,
          answeredElsewhere: answer === null && approval.state === "answered",
          decisions: answerableDecisions(approval.payload),
          id: approval.id,
          reason: approval.payload.reason,
        };
      }),
    desktops: state.desktops,
    pending: state.dispatches
      .filter(isTurn)
      .filter(
        (dispatch) =>
          dispatch.threadId === threadId && thread?.dispatchIds.has(dispatch.id) !== true,
      ),
  };
};

export interface ThreadListEntry {
  threadId: string;
  title: string;
  caption: string;
}

// what is moving outranks what was said: a question for the phone, then its own pending message,
// then a Mac at work, then the thread's last line
const captionFor = (
  threadId: string,
  thread: ThreadProjection | null,
  state: DispatchState,
): string => {
  const { approvals, pending, desktops } = threadDispatches(threadId, thread, state);
  if (approvals.some((approval) => approval.answer === null && !approval.answeredElsewhere)) {
    return ASKING_CAPTION;
  }
  const latest = pending.at(-1);
  if (latest !== undefined) {
    return dispatchCaption(latest.phase, desktops);
  }
  if (thread === null) {
    return "";
  }
  if (thread.running) {
    return WORKING_CAPTION;
  }
  return [thread.archived ? "Archived" : "", thread.preview]
    .filter((part) => part !== "")
    .join(" · ");
};

// a thread that exists only on this phone so far comes first, newest first: no Mac has written it
// to the log yet, so it is named by its first message
export const threadListEntries = (
  synced: readonly ThreadProjection[],
  state: DispatchState,
): ThreadListEntry[] => {
  const known = new Set(synced.map((thread) => thread.threadId));
  const localOnly = new Map<string, { first: TurnDispatch; last: TurnDispatch }>();
  for (const dispatch of state.dispatches.filter(isTurn)) {
    if (!known.has(dispatch.threadId)) {
      const group = localOnly.get(dispatch.threadId);
      localOnly.set(dispatch.threadId, { first: group?.first ?? dispatch, last: dispatch });
    }
  }
  const local = [...localOnly.values()]
    .toSorted((a, b) => b.last.createdAt - a.last.createdAt)
    .map(({ first }) => ({
      caption: captionFor(first.threadId, null, state),
      threadId: first.threadId,
      title: deriveThreadTitle(first.text) ?? UNTITLED_THREAD,
    }));
  return [
    ...local,
    ...synced.map((thread) => ({
      caption: captionFor(thread.threadId, thread, state),
      threadId: thread.threadId,
      title: thread.title,
    })),
  ];
};

// the title of a thread the thread view opens: the log's, else its first message on this phone
export const localThreadTitle = (pending: readonly TurnDispatch[]): string | null => {
  const [first] = pending;
  return first === undefined ? null : (deriveThreadTitle(first.text) ?? UNTITLED_THREAD);
};
