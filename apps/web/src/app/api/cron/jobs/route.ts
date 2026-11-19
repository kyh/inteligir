import { serveJobsCron } from "@repo/service/jobs/drain-jobs";

export const GET = async (request: Request) => await serveJobsCron(request);

export const maxDuration = 300;
