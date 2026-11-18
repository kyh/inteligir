import { serveAgentCron } from "@repo/service/agent/agent-cron";

export const GET = async (request: Request) => await serveAgentCron(request);

export const maxDuration = 300;
