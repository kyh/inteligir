import { serveHousekeeping } from "@repo/service/jobs/housekeeping";

export const GET = async (request: Request) => await serveHousekeeping(request);

export const maxDuration = 300;
