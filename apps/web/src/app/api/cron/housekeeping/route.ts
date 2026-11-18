import { serveHousekeeping } from "@repo/service/jobs/housekeeping";

export const GET = async (request: Request): Promise<Response> => await serveHousekeeping(request);

// a large library's hour of deletions is released in one run
export const maxDuration = 300;
