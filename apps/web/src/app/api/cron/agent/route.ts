import { serveAgentCron } from "@repo/service/agent/agent-cron";

export const GET = async (request: Request): Promise<Response> => await serveAgentCron(request);

// a run ends up to ten eve sessions, each a call to the agent
export const maxDuration = 300;
