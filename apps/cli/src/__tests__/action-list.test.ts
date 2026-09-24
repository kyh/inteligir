// against the real composition: the cursor is the server's to mint and to read back.

import { setTimeout as delay } from "node:timers/promises";
import { listThreadsResponseSchema } from "@repo/api/local/threads/threads-schema";
import { describe, expect, it } from "vitest";
import { bootThreadHarness, listenTestApp, TEST_SERVER_TOKEN } from "../server/__tests__/boot-app";
import { loopbackOrigin } from "../server/server-file";
import { runCliForTest } from "./run-cli";

const HINT = /^\(more; pass --cursor (?<cursor>\S+) for the next page\)$/u;

describe("action list", () => {
  it("pages by cursor, newest first, and leaves archived actions to --archived", async () => {
    const booted = await bootThreadHarness({ mode: "manual" });
    const { client, port } = await listenTestApp(booted);
    const baseUrl = loopbackOrigin(port);
    const list = async (...argv: string[]) =>
      await runCliForTest({ argv: ["action", "list", ...argv], baseUrl, token: TEST_SERVER_TOKEN });

    // a millisecond apart, so the order is the creation order and no tie decides it.
    const created: string[] = [];
    for (const title of ["Oldest", "Middle", "Newest"]) {
      const { thread } = await client.threads.create({ title });
      created.push(thread.id);
      await delay(2);
    }
    const [oldest, middle, newest] = created;
    if (oldest === undefined || middle === undefined || newest === undefined) {
      throw new Error("expected three actions");
    }
    await client.threads.archive({ threadId: oldest });

    const firstPage = await list("--limit", "1");
    expect(firstPage.code).toBe(0);
    const [row, hint] = firstPage.stdout.trimEnd().split("\n");
    expect(row).toBe(`${newest}  idle  Newest`);
    const cursor = HINT.exec(hint ?? "")?.groups?.cursor;
    if (cursor === undefined) {
      throw new Error(`expected a cursor hint, got ${JSON.stringify(hint)}`);
    }

    const secondPage = await list("--limit", "1", "--cursor", cursor);
    expect(secondPage.stdout).toBe(`${middle}  idle  Middle\n`);

    // the archive touched it last, and it still lists after every live action.
    const withArchived = await list("--archived", "--json");
    const body = listThreadsResponseSchema.parse(JSON.parse(withArchived.stdout));
    expect(body.threads.map((thread) => thread.id)).toEqual([newest, middle, oldest]);
    expect(body.nextCursor).toBeNull();
  });

  it("refuses a cursor no listing answered", async () => {
    const booted = await bootThreadHarness({ mode: "manual" });
    const { port } = await listenTestApp(booted);
    const refused = await runCliForTest({
      argv: ["action", "list", "--cursor", "not-a-cursor"],
      baseUrl: loopbackOrigin(port),
      token: TEST_SERVER_TOKEN,
    });
    expect(refused.code).toBe(1);
  });
});
