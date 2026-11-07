// A conversation's object is named `agent-thread:<accountId>:<threadId>` and reached through the
// Worker's own export (`ctx.exports.AgentThreadDO`, no env binding). Naming an object creates it,
// so only the account's cell names one, and only for a thread its own rows hold: this module is
// importable from `../library/library-do.ts` and `./agent-turns.ts` alone (oxlint.config.ts). The
// object reads its account back from its own name, and reaches that account's cell alone.

import type { AgentThreadDO } from "./agent-thread";
import { AGENT_THREAD_PREFIX } from "./agent-thread";

const threadObjectName = (accountId: string, threadId: string): string =>
  `${AGENT_THREAD_PREFIX}${accountId}:${threadId}`;

export const threadStub = (
  exports: Cloudflare.Exports,
  accountId: string,
  threadId: string,
): DurableObjectStub<AgentThreadDO> =>
  exports.AgentThreadDO.getByName(threadObjectName(accountId, threadId));
