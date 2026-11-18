// `library.agent.*`'s rows over the built-in agent's threads: a message sent to eve as the person,
// their threads and what each recorded, a stop, a delete, and the agent's standing for them.

import { NotFoundError } from "@repo/contract/rpc/v1-errors";

import { reading, writing } from "../library/library-access";
import { agentStatus, cancelAgentTurn, deleteAgentThread, sendToAgent } from "./agent-sessions";
import { listThreads, threadEvents, threadOf } from "./agent-threads";
import { deploymentAgentRuntime } from "./runtime";

export const agentReadRows = {
  events: reading.agent.events.handler(async ({ context, input }) => {
    const { accountId } = context.library;
    if ((await threadOf(accountId, input.threadId)) === null) {
      throw new NotFoundError();
    }
    return await threadEvents(accountId, input);
  }),
  list: reading.agent.list.handler(
    async ({ context, input }) => await listThreads(context.library.accountId, input),
  ),
  status: reading.agent.status.handler(
    async ({ context }) => await agentStatus(context.library.accountId, Date.now()),
  ),
};

export const agentWriteRows = {
  cancel: writing.agent.cancel.handler(
    async ({ context, input }) =>
      await cancelAgentTurn(deploymentAgentRuntime(), context.library.accountId, input.threadId),
  ),
  delete: writing.agent.delete.handler(
    async ({ context, input }) =>
      await deleteAgentThread(deploymentAgentRuntime(), context.library.accountId, input.threadId),
  ),
  send: writing.agent.send.handler(
    async ({ context, input }) =>
      await sendToAgent(deploymentAgentRuntime(), context.library.accountId, input),
  ),
};
