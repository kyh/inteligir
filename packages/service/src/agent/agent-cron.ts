// The agent's housekeeping, every 15 minutes by Vercel Cron (apps/web/vercel.json): what a response
// left unfinished, each item tried alone so one failure waits for the next run.

import { serveCron } from "../cron";
import { env } from "../env";
import { purgeRetiredThreads } from "./agent-sessions";
import type { AgentRuntime } from "./runtime";
import { deploymentAgentRuntime } from "./runtime";

export const runAgentCron = async (runtime: AgentRuntime | null) => ({
  threads: await purgeRetiredThreads(runtime),
});

export const serveAgentCron = async (request: Request): Promise<Response> =>
  await serveCron(
    request,
    env.CRON_SECRET,
    async () => await runAgentCron(deploymentAgentRuntime()),
  );
