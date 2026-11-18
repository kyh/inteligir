import { describe, expect, it } from "vitest";

import { serveCron } from "./cron";

const call = (authorization?: string) =>
  new Request("http://localhost/api/cron/agent", {
    headers: authorization === undefined ? {} : { authorization },
  });

const run = async () => await Promise.resolve({ ran: true });

describe("a scheduled job's route", () => {
  it("runs for the scheduled job's bearer alone", async () => {
    const ran = await serveCron(call("Bearer s3cret"), "s3cret", run);
    expect(ran.status).toBe(200);
    await expect(ran.json()).resolves.toStrictEqual({ ran: true });
    for (const refused of [
      await serveCron(call(), "s3cret", run),
      await serveCron(call("Bearer guess"), "s3cret", run),
      await serveCron(call("Bearer "), "", run),
      await serveCron(call("Bearer undefined"), undefined, run),
    ]) {
      expect(refused.status).toBe(401);
    }
  });
});
