import { serveJobsCron } from "@repo/service/jobs/drain-jobs";

export const GET = async (request: Request): Promise<Response> => await serveJobsCron(request);

// a run leases jobs for 240 s, and the last one leased runs on past that
export const maxDuration = 300;
