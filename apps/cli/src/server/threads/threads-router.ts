// The thread handlers. Each one translates a typed service outcome into the
// contract's response union — nothing here reads the db or knows a send mode.
//
// The refusals stay INLINE rather than behind one table: a send's conflict is
// the service's own outcome union, not a thrown class, so each switch is
// already exhaustive over what its own procedure can answer.

import { base } from "../orpc";

const THREAD_NOT_FOUND = "Thread not found";

const list = base.threads.list.handler(({ context }) => ({ threads: context.threads.list() }));

const get = base.threads.get.handler(({ context, input, errors }) => {
  const detail = context.threads.get(input.threadId);
  if (detail === null) {
    throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
  }
  return detail;
});

const create = base.threads.create.handler(({ context, input }) => ({
  thread: context.threads.create(input),
}));

const archive = base.threads.archive.handler(({ context, input, errors }) => {
  const thread = context.threads.archive(input.threadId);
  if (thread === null) {
    throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
  }
  return { thread };
});

const send = base.threads.send.handler(({ context, input, errors }) => {
  const outcome = context.threads.send(input);
  switch (outcome.kind) {
    case "started":
    case "steered":
      return { kind: outcome.kind, turnId: outcome.turnId };
    case "queued":
      return { kind: "queued", queuedMessageId: outcome.queuedMessageId };
    case "not-found":
      throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
    case "provider-unavailable":
      throw errors.PROVIDER_UNAVAILABLE({ message: outcome.message });
    case "dispatch-failed":
      throw errors.DISPATCH_FAILED({
        message: "The agent provider failed to accept the turn",
      });
    case "conflict":
      switch (outcome.error) {
        case "archived":
          throw errors.ARCHIVED({ message: outcome.message });
        case "stale_turn":
          throw errors.STALE_TURN({ message: outcome.message });
        case "not_steerable":
          throw errors.NOT_STEERABLE({ message: outcome.message });
      }
  }
});

const timeline = base.threads.timeline.handler(({ context, input, errors }) => {
  const response = context.threads.timeline(input);
  if (response === null) {
    throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
  }
  return response;
});

const listInteractions = base.threads.listInteractions.handler(({ context, input }) => ({
  interactions: context.threads.listInteractions(input.threadId),
}));

const answerInteraction = base.threads.answerInteraction.handler(({ context, input, errors }) => {
  const outcome = context.threads.answerInteraction(input);
  switch (outcome.kind) {
    case "resolved":
      return { interaction: outcome.interaction };
    case "already-resolved":
      throw errors.ALREADY_RESOLVED({ message: "The interaction was already answered" });
    case "invalid-resolution":
      throw errors.INVALID_RESOLUTION({ message: outcome.message });
    case "not-found":
      throw errors.NOT_FOUND({ message: "Interaction not found" });
  }
});

export const threadsRouter = {
  list,
  get,
  create,
  archive,
  send,
  timeline,
  listInteractions,
  answerInteraction,
};
