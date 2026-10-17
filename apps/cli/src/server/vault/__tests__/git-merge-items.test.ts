// Two Macs meeting one saved link in a sync pass: the url-item verdict settles their two versions
// on one text, which both repos and the remote end up holding, with no conflict copy.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { composeLinkBody } from "@repo/notes/items/item-body";
import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import type { ItemFileFields } from "@repo/notes/items/item-frontmatter";
import { linkStubText } from "@repo/notes/items/item-stub";
import { describe, expect, it } from "vitest";
import {
  conflictCopies,
  expectCleanRepo,
  git,
  makeBareRemote,
  makeEngine,
  syncState,
} from "./git-fixtures";

const ITEM = "Unsorted/File over app.md";
const ID = "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17";
const URL = "https://stephango.com/file-over-app";
const SAVED_MS = Date.UTC(2026, 9, 17, 9, 12, 30);

const STUB = linkStubText({ id: ID, note: "For Tuesday.", saved: SAVED_MS, url: URL });

const fill = (fetched: string, cover: string, extra: ItemFileFields = {}): string =>
  composeItemFile(
    {
      description: "Files you can control.",
      fetched,
      id: ID,
      kind: "link",
      saved: "2026-10-17T09:12:30Z",
      site: "Steph Ango",
      url: URL,
      ...extra,
    },
    composeLinkBody({
      article: "File over app is a philosophy.",
      copy: null,
      cover,
      note: "For Tuesday.",
    }),
  );

const EARLY = fill("2026-10-17T09:12:33Z", "assets/covers/3f9a0c2b1d4e5f60.jpg");
const LATE = fill("2026-10-17T09:12:41Z", "assets/covers/9c1d0a7b6e5f4c3d.jpg");

type Mac = Awaited<ReturnType<typeof makeEngine>>;

const commitFile = async (mac: Mac, relPath: string, content: string): Promise<void> => {
  const file = path.join(mac.root, relPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  await mac.engine.commitNow();
};

const readItem = async (mac: Mac): Promise<string> =>
  await readFile(path.join(mac.root, ITEM), "utf-8");

const treeOf = async (root: string): Promise<string> => {
  const { stdout } = await git.run(root, ["rev-parse", "HEAD^{tree}"]);
  return stdout.trim();
};

// two Macs on one remote, both holding `held` at ITEM
const pairHolding = async (held: string) => {
  const remote = await makeBareRemote();
  const a = await makeEngine({ device: "Kai’s MacBook", remoteUrl: remote });
  const b = await makeEngine({ device: "Kai’s iMac", remoteUrl: remote });
  await commitFile(a, ITEM, held);
  expect(await syncState(a.engine)).toBe("clean");
  expect(await syncState(b.engine)).toBe("clean");
  expect(await readItem(b)).toBe(held);
  return { a, b, remote };
};

// every repo and the remote hold one tree, and nobody holds a copy
const expectConverged = async (a: Mac, b: Mac, remote: string, text: string): Promise<void> => {
  expect(await syncState(a.engine)).toBe("clean");
  expect(await readItem(a)).toBe(text);
  expect(await readItem(b)).toBe(text);
  const { stdout } = await git.run(remote, ["rev-parse", "main^{tree}"]);
  expect(await treeOf(a.root)).toBe(stdout.trim());
  expect(await treeOf(b.root)).toBe(stdout.trim());
  for (const mac of [a, b]) {
    expect(await conflictCopies(mac.root)).toEqual([]);
    const status = await mac.engine.status();
    expect(status.conflicts).toEqual([]);
    await expectCleanRepo(mac.root);
  }
};

describe("a sync pass over two versions of one saved link", { timeout: 30_000 }, () => {
  it("settles two fills of one stub on the earlier one, whichever pushed first", async () => {
    for (const [first, second] of [
      [EARLY, LATE],
      [LATE, EARLY],
    ] as const) {
      const { a, b, remote } = await pairHolding(STUB);
      await commitFile(a, ITEM, first);
      expect(await syncState(a.engine)).toBe("clean");
      await commitFile(b, ITEM, second);
      expect(await syncState(b.engine)).toBe("clean");
      expect(await readItem(b)).toBe(EARLY);
      await expectConverged(a, b, remote, EARLY);
    }
  });

  it("keeps both a refresh on one Mac and a tag added on the other", async () => {
    const { a, b, remote } = await pairHolding(EARLY);
    const refreshed = fill("2026-10-18T08:00:00Z", "assets/covers/9c1d0a7b6e5f4c3d.jpg", {
      description: "A newer summary.",
    });
    const tagged = fill("2026-10-17T09:12:33Z", "assets/covers/3f9a0c2b1d4e5f60.jpg", {
      tags: ["read"],
    });
    await commitFile(a, ITEM, refreshed);
    expect(await syncState(a.engine)).toBe("clean");
    await commitFile(b, ITEM, tagged);
    expect(await syncState(b.engine)).toBe("clean");
    await expectConverged(
      a,
      b,
      remote,
      fill("2026-10-18T08:00:00Z", "assets/covers/9c1d0a7b6e5f4c3d.jpg", {
        description: "A newer summary.",
        tags: ["read"],
      }),
    );
  });
});
