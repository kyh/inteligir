import { timingSafeEqual } from "node:crypto";

// WARNING: never answer a cron call without CRON_SECRET as its bearer; with none set, every call is refused
const isCronCall = (authorization: string | null, secret: string | undefined) => {
  if (secret === undefined || secret === "" || authorization === null) {
    return false;
  }

  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);

  return given.length === expected.length && timingSafeEqual(given, expected);
};

export const serveCron = async (
  request: Request,
  secret: string | undefined,
  run: () => Promise<object>,
) => {
  if (!isCronCall(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Only the scheduled job may call this." }, { status: 401 });
  }

  return Response.json(await run());
};
