// A scheduled job's route answers only Vercel Cron, which sends CRON_SECRET as its bearer; with no
// secret set every call is refused, so a cron route never runs for whoever finds its address.

import { timingSafeEqual } from "node:crypto";

const isCronCall = (authorization: string | null, secret: string | undefined): boolean => {
  if (secret === undefined || secret === "" || authorization === null) {
    return false;
  }
  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

// `secret` is the deployment's CRON_SECRET
export const serveCron = async (
  request: Request,
  secret: string | undefined,
  run: () => Promise<object>,
): Promise<Response> => {
  if (!isCronCall(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Only the scheduled job may call this." }, { status: 401 });
  }
  return Response.json(await run());
};
