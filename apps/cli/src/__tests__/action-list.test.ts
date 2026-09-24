// against the real composition: the cursor is the server's to mint and to read back.

import { setTimeout as delay } from "node:timers/promises";
import { listThreadsResponseSchema } from "@repo/api/local/threads/threads-schema";
import { describe, expect, it } from "vitest";
import { bootThreadHarness, listenTestApp, TEST_SERVER_TOKEN } from "../server/__tests__/boot-app";
import { loopbackOrigin } from "../server/server-file";
import { runCliForTest } from "./run-cli";

const HINT = /^\(more; pass --cursor (?<cursor>\S+)(?<flags>.*) for the next page\)$/u;

const bootLister = async () => {
  const booted = await bootThreadHarness({ mode: "manual" });
  const { client, port } = await listenTestApp(booted);
  const baseUrl = loopbackOrigin(port);
  const list = async (...argv: string[]) =>
    await runCliForTest({ argv: ["action", "list", ...argv], baseUrl, token: TEST_SERVER_TOKEN });
  // a millisecond apart, so the order is the creation order and no tie decides it.
  const create = async (title: string, originDocPath?: string): Promise<string> => {
    const { thread } = await client.threads.create(
      originDocPath === undefined ? { title } : { originDocPath, title },
    );
    await delay(2);
    return thread.id;
  };
  return { client, create, list };
};

// the page's rows, and the hint's cursor and the flags it says to repeat.
interface ListedPage {
  rows: string[];
  cursor: string;
  flags: string;
}

const readPage = (stdout: string): ListedPage => {
  const lines = stdout.trimEnd().split("\n");
  const hint = lines.at(-1) ?? "";
  const groups = HINT.exec(hint)?.groups;
  if (groups?.cursor === undefined || groups.flags === undefined) {
    throw new Error(`expected a cursor hint, got ${JSON.stringify(hint)}`);
  }
  return { cursor: groups.cursor, flags: groups.flags, rows: lines.slice(0, -1) };
};

describe("action list", () => {
  it("pages by cursor, newest first, and leaves archived actions to --archived", async () => {
    const { client, create, list } = await bootLister();
    const oldest = await create("Oldest");
    const middle = await create("Middle");
    const newest = await create("Newest");
    await client.threads.archive({ threadId: oldest });

    const firstPage = await list("--limit", "1");
    expect(firstPage.code).toBe(0);
    const first = readPage(firstPage.stdout);
    expect(first.rows).toEqual([`${newest}  idle  Newest`]);
    expect(first.flags).toBe(" --limit 1");

    const secondPage = await list("--cursor", first.cursor, "--limit", "1");
    expect(secondPage.stdout).toBe(`${middle}  idle  Middle\n`);

    // the archive touched it last, and it still lists after every live action.
    const withArchived = await list("--archived", "--json");
    const body = listThreadsResponseSchema.parse(JSON.parse(withArchived.stdout));
    expect(body.threads.map((thread) => thread.id)).toEqual([newest, middle, oldest]);
    expect(body.nextCursor).toBeNull();
  });

  // the cursor names a position, not the query: dropped flags continue another listing.
  it("names every filter the next page must repeat, and following it stays filtered", async () => {
    const { client, create, list } = await bootLister();
    const doc = "notes/the plan.md";
    const olderOnDoc = await create("Older on doc", doc);
    const elsewhere = await create("Elsewhere");
    const newerOnDoc = await create("Newer on doc", doc);
    await client.threads.archive({ threadId: elsewhere });

    const firstByDoc = await list("--doc", doc, "--limit", "1");
    const byDoc = readPage(firstByDoc.stdout);
    expect(byDoc.rows).toEqual([`${newerOnDoc}  idle  Newer on doc`]);
    expect(byDoc.flags).toBe(" --doc 'notes/the plan.md' --limit 1");
    const nextByDoc = await list("--cursor", byDoc.cursor, "--doc", doc, "--limit", "1");
    expect(nextByDoc.stdout).toBe(`${olderOnDoc}  idle  Older on doc\n`);

    // two live rows fill the page, so its cursor sits at the end of the live segment and only
    // --archived reaches the rest.
    const firstArchived = await list("--archived", "--limit", "2");
    const archived = readPage(firstArchived.stdout);
    expect(archived.rows).toEqual([
      `${newerOnDoc}  idle  Newer on doc`,
      `${olderOnDoc}  idle  Older on doc`,
    ]);
    expect(archived.flags).toBe(" --archived --limit 2");
    const nextArchived = await list("--cursor", archived.cursor, "--archived", "--limit", "2");
    expect(nextArchived.stdout).toBe(`${elsewhere}  idle  Elsewhere  (archived)\n`);
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
