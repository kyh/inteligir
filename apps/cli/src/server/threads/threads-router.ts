// refusals stay inline: a send's conflict is the service's outcome union, so each switch is already exhaustive.

import { base } from "../orpc";

const THREAD_NOT_FOUND = "Thread not found";

const list = base.threads.list.handler(
  async ({ context, input }) => await context.threads.list(input),
);

const get = base.threads.get.handler(async ({ context, input, errors }) => {
  const detail = await context.threads.get(input.threadId);
  if (detail === null) {
    throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
  }
  return detail;
});

const create = base.threads.create.handler(async ({ context, input }) => ({
  thread: await context.threads.create(input),
}));

const archive = base.threads.archive.handler(async ({ context, input, errors }) => {
  const thread = await context.threads.archive(input.threadId);
  if (thread === null) {
    throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
  }
  return { thread };
});

const interrupt = base.threads.interrupt.handler(async ({ context, input, errors }) => {
  const outcome = await context.threads.interrupt(input.threadId);
  switch (outcome.kind) {
    case "answered": {
      return { stop: outcome.stop, thread: outcome.thread };
    }
    case "not-found": {
      throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
    }
    case "remote": {
      throw errors.CONFLICT({ message: outcome.message });
    }
    // no default
  }
});

const send = base.threads.send.handler(({ context, input, errors }) => {
  const outcome = context.threads.send(input);
  switch (outcome.kind) {
    case "started": {
      return { kind: "started", turnId: outcome.turnId };
    }
    case "queued": {
      return { kind: "queued", queuedMessageId: outcome.queuedMessageId };
    }
    case "not-found": {
      throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
    }
    case "provider-unavailable": {
      throw errors.PROVIDER_UNAVAILABLE({ message: outcome.message });
    }
    case "dispatch-failed": {
      throw errors.DISPATCH_FAILED({
        message: "The agent provider failed to accept the turn",
      });
    }
    case "conflict": {
      switch (outcome.error) {
        case "archived": {
          throw errors.ARCHIVED({ message: outcome.message });
        }
        case "stale_turn": {
          throw errors.STALE_TURN({ message: outcome.message });
        }
        // no default
      }
    }
    // no default
  }
});

const timeline = base.threads.timeline.handler(({ context, input, errors }) => {
  const response = context.threads.timeline(input);
  if (response === null) {
    throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
  }
  return response;
});

const turnChanges = base.threads.turnChanges.handler(async ({ context, input, errors }) => {
  const changes = await context.turnChanges(input.threadId);
  if (changes === null) {
    throw errors.NOT_FOUND({ message: THREAD_NOT_FOUND });
  }
  return changes;
});

// never attributed to a running turn: the agent may be asking for this undo from inside a later
// turn of the same thread, and that turn's commit must not carry it.
const undoTurn = base.threads.undoTurn.handler(async ({ context, input, errors }) => {
  const outcome = await context.undoTurn(input.threadId, input.turnId);
  switch (outcome.kind) {
    case "undone": {
      return outcome.changes;
    }
    case "not-found": {
      throw errors.NOT_FOUND({ message: outcome.message });
    }
    case "conflict": {
      throw errors.CONFLICT({ message: outcome.message });
    }
    // no default
  }
});

const listInteractions = base.threads.listInteractions.handler(({ context, input }) => ({
  interactions: context.threads.listInteractions(input.threadId),
}));

const answerInteraction = base.threads.answerInteraction.handler(({ context, input, errors }) => {
  const outcome = context.threads.answerInteraction(input);
  switch (outcome.kind) {
    case "resolved": {
      return { interaction: outcome.interaction };
    }
    case "already-resolved": {
      throw errors.ALREADY_RESOLVED({ message: "The interaction was already answered" });
    }
    case "invalid-resolution": {
      throw errors.INVALID_RESOLUTION({ message: outcome.message });
    }
    case "not-found": {
      throw errors.NOT_FOUND({ message: "Interaction not found" });
    }
    // no default
  }
});

export const threadsRouter = {
  answerInteraction,
  archive,
  create,
  get,
  interrupt,
  list,
  listInteractions,
  send,
  timeline,
  turnChanges,
  undoTurn,
};
