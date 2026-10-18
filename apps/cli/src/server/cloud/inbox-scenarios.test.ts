import { INBOX_SCENARIOS } from "@repo/contract/cloud/test-support/inbox-scenarios";
import { describe, expect, it } from "vitest";
import { FakeCloud } from "./test-support/fake-cloud";

// the table apps/web runs against the deployed object: a row failing here is the fake drifting
describe("the fake cloud's inboxes", () => {
  it.each(INBOX_SCENARIOS)("$name", async ({ expected, run }) => {
    const cloud = new FakeCloud();
    const observed = await run({
      lapseClaims: async () => {
        cloud.lapseClaims();
      },
      signIn: async (name) => await cloud.signInDevice(name),
    });
    expect(observed).toEqual(expected);
  });
});
