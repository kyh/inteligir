import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";

const PLANS = "notes/plans.md";

// what a watcher delivers for a move nobody announced: Finder, an agent's `mv`, a pull
const moveOutsideTheApp = async (app: BootedTestApp, from: string, to: string): Promise<void> => {
  await mkdir(path.dirname(path.join(app.vaultDir, to)), { recursive: true });
  await rename(path.join(app.vaultDir, from), path.join(app.vaultDir, to));
  app.composed.context.knowledge.noteVaultChange({ kind: "paths", paths: [from, to] });
};

const originOf = async (app: BootedTestApp, threadId: string): Promise<string | null> => {
  const detail = await app.client.threads.get({ threadId });
  const listed = await app.client.threads.list({ includeArchived: true });
  expect(listed.threads.find((thread) => thread.id === threadId)?.originDocPath).toBe(
    detail.thread.originDocPath,
  );
  return detail.thread.originDocPath;
};

describe("an action's origin", () => {
  it("follows its note through a move the rename route never saw, by the id minted at compose", async () => {
    const app = await bootTestApp();
    await app.client.vault.write({
      content: "# Plans\n",
      guard: { kind: "overwrite" },
      path: PLANS,
    });

    const { thread } = await app.client.threads.create({ originDocPath: PLANS });
    expect(thread.originDocPath).toBe(PLANS);
    const minted = await readFile(path.join(app.vaultDir, PLANS), "utf-8");
    expect(frontmatterId(minted)).not.toBeNull();
    expect(minted.endsWith("# Plans\n")).toBe(true);

    await moveOutsideTheApp(app, PLANS, "archive/plans.md");
    expect(await originOf(app, thread.id)).toBe("archive/plans.md");

    // with no note carrying the id, the path it was composed at is all the thread knows
    await rm(path.join(app.vaultDir, "archive/plans.md"));
    app.composed.context.knowledge.noteVaultChange({ kind: "paths", paths: ["archive/plans.md"] });
    expect(await originOf(app, thread.id)).toBe(PLANS);
  });

  it("keeps the id a note already carries, writing nothing into it", async () => {
    const app = await bootTestApp();
    const content = "---\nid: plans-id\n---\n# Plans\n";
    await app.client.vault.write({ content, guard: { kind: "overwrite" }, path: PLANS });

    const { thread } = await app.client.threads.create({ originDocPath: PLANS });
    expect(await readFile(path.join(app.vaultDir, PLANS), "utf-8")).toBe(content);

    await moveOutsideTheApp(app, PLANS, "moved.md");
    expect(await originOf(app, thread.id)).toBe("moved.md");
  });

  it("binds by path alone when the note cannot take an id, and never refuses the action", async () => {
    const app = await bootTestApp();
    const unreadable = "---\na: [unclosed\n---\nbody\n";
    await app.client.vault.write({
      content: unreadable,
      guard: { kind: "overwrite" },
      path: PLANS,
    });

    const { thread } = await app.client.threads.create({ originDocPath: PLANS });
    expect(thread.originDocPath).toBe(PLANS);
    expect(await readFile(path.join(app.vaultDir, PLANS), "utf-8")).toBe(unreadable);

    const { thread: unwritten } = await app.client.threads.create({ originDocPath: "later.md" });
    expect(unwritten.originDocPath).toBe("later.md");
  });
});
