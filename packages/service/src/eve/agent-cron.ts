import { serveCron } from "../cron";
import { env } from "../env";
import { trimUsage } from "../agent/agent-limits";
import { purgeRetiredThreads } from "../agent/agent-sessions";
import { retryDeletedAccountSessions } from "../agent/deleted-account-sessions";
import { settleStrandedTurns } from "./eve-agent";
import type { AgentRuntime } from "../agent/runtime";
import { deploymentAgentRuntime } from "../agent/runtime";

export const runAgentCron = async (runtime: AgentRuntime | null, now = Date.now()) => ({
  sessions: await retryDeletedAccountSessions(runtime, now),
  threads: await purgeRetiredThreads(runtime, now),
  turns: await settleStrandedTurns(now),
  usage: { trimmed: await trimUsage(now) },
});

export const serveAgentCron = async (request: Request) =>
  await serveCron(
    request,
    env.CRON_SECRET,
    async () => await runAgentCron(deploymentAgentRuntime()),
  );
