// against the real composition, not the fixture server: the title is the server's to derive, and
// the fixture would only echo whatever the test told it.

import { describe, expect, it } from "vitest";
import { bootThreadHarness, listenTestApp, TEST_SERVER_TOKEN } from "../server/__tests__/boot-app";
import { loopbackOrigin } from "../server/server-file";
import { runCliForTest } from "./run-cli";

describe("action new", () => {
  it("leaves a thread titled by its prompt, which action list shows", async () => {
    const booted = await bootThreadHarness({ mode: "manual" });
    const { client, port } = await listenTestApp(booted);
    const baseUrl = loopbackOrigin(port);

    const created = await runCliForTest({
      argv: ["action", "new", "Tidy the intro\nand the outro"],
      baseUrl,
      token: TEST_SERVER_TOKEN,
    });
    expect(created.code).toBe(0);

    const { threads } = await client.threads.list({});
    expect(threads.map((thread) => thread.title)).toEqual(["Tidy the intro"]);

    const listed = await runCliForTest({
      argv: ["action", "list"],
      baseUrl,
      token: TEST_SERVER_TOKEN,
    });
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("Tidy the intro");
  });
});
