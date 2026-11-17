// `library.agent.*`, the built-in agent's rows, over its turns as the account's cell keeps them
// (`./agent-turns`) and what they changed (`../library/cell-undo`): a plain object the library's
// router takes in (`../library/library-router`).

import { z } from "zod";

import {
  mergeTurnUndos,
  planUndo,
  undoableTurns,
  undoChangeSets,
  undoneSchema,
} from "../library/cell-undo";
import { answer, os } from "../library/library-orpc";
import { readLibraryRules, writeLibraryRules } from "../library/library-rules";
import type { TurnUndone } from "../note/note-wire";
import { readThreadEvents } from "./agent-events";
import { setAgentEnabled } from "./agent-switch";
import {
  agentStatus,
  cancelTurn,
  deleteAgentThread,
  respondToAgent,
  sendToAgent,
} from "./agent-turns";
import { listThreads } from "./turn-rows";

const rulesAnswer = z.object({ rules: z.string() });

export const agentRouter = {
  cancel: os.agent.cancel.handler(async ({ context, input }) =>
    answer(await cancelTurn(context.agent, input)),
  ),
  delete: os.agent.delete.handler(async ({ context, input }) =>
    answer(await deleteAgentThread(context.agent, input)),
  ),
  events: os.agent.events.handler(({ context, input }) =>
    context.read((db) => readThreadEvents(db, input)),
  ),
  list: os.agent.list.handler(({ context, input }) => context.read((db) => listThreads(db, input))),
  respond: os.agent.respond.handler(async ({ context, input }) =>
    answer(await respondToAgent(context.agent, input)),
  ),
  rules: os.agent.rules.handler(({ context }) =>
    context.read((db) => ({ rules: readLibraryRules(db) })),
  ),
  send: os.agent.send.handler(async ({ context, input }) =>
    answer(await sendToAgent(context.agent, input)),
  ),
  setEnabled: os.agent.setEnabled.handler(({ context, input }) =>
    answer(setAgentEnabled(context.agent, input)),
  ),
  // a fact of the cell's own, joining no change set: rules are no item's
  setRules: os.agent.setRules.handler(({ context, input }) =>
    context.landApart({ answer: rulesAnswer, opId: input.opId }, (scope) => {
      writeLibraryRules(scope.db, input.rules);
      return { rules: input.rules };
    }),
  ),
  // whether it is on, and what is left of the day's allowance
  status: os.agent.status.handler(({ context }) => answer(agentStatus(context.agent))),
  // the notes the picked turns wrote in undo first, outside any transaction; the write then lands
  // what they answered beside the fields, as whoever pressed Undo, so it joins no change set
  undo: os.agent.undo.handler(async ({ context, input }) => {
    const plan = context.read((db) => planUndo(db, input));
    const answers: { itemId: string; undone: TurnUndone }[] = [];
    for (const { itemId, setId } of plan.notes) {
      answers.push({ itemId, undone: await context.notes(itemId).undoTurn(setId) });
    }
    return context.land({ answer: undoneSchema, opId: undefined }, (scope) =>
      undoChangeSets(scope, plan, mergeTurnUndos(answers)),
    );
  }),
  undoable: os.agent.undoable.handler(({ context, input }) =>
    context.read((db) => ({ turns: undoableTurns(db, input.threadId) })),
  ),
};
