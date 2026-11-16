// `library.agent.*`, the built-in agent's rows, over its turns as the account's cell keeps them
// (`./agent-turns`): a plain object the library's router takes in (`../library/library-router`).

import { z } from "zod";

import { listThreads, threadEvents } from "../library/cell-threads";
import { answer, os } from "../library/library-orpc";
import { readLibraryRules, writeLibraryRules } from "../library/library-rules";
import { setAgentEnabled } from "./agent-switch";
import {
  agentStatus,
  cancelTurn,
  deleteAgentThread,
  respondToAgent,
  sendToAgent,
} from "./agent-turns";

const rulesAnswer = z.object({ rules: z.string() });

export const agentRouter = {
  cancel: os.agent.cancel.handler(async ({ context, input }) =>
    answer(await cancelTurn(context.agent, input)),
  ),
  delete: os.agent.delete.handler(async ({ context, input }) =>
    answer(await deleteAgentThread(context.agent, input)),
  ),
  events: os.agent.events.handler(({ context, input }) =>
    context.read((db) => threadEvents(db, input)),
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
  // a meta row of the library's, joining no change set: rules are no item's
  setRules: os.agent.setRules.handler(({ context, input }) =>
    context.landApart({ answer: rulesAnswer, opId: input.opId }, (scope) => {
      writeLibraryRules(scope.db, input.rules);
      return { rules: input.rules };
    }),
  ),
  // whether it is on, and what is left of the day's allowance
  status: os.agent.status.handler(({ context }) => answer(agentStatus(context.agent))),
};
