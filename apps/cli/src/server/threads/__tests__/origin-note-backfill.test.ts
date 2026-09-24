import { readFile } from "node:fs/promises";
import path from "node:path";
import { createThread, getThread } from "@repo/db/threads";
import { noopNotifier } from "@repo/domain/notifier";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";

const PLANS = "notes/plans.md";

// a row as a database from before origin_note_id holds it: the path it was composed at, no id
const pathOnlyThread = (app: BootedTestApp, notePath: string): string =>
  createThread(app.db, noopNotifier, { origin: { noteId: null, path: notePath } }).id;

const readNote = async (app: BootedTestApp, notePath: string): Promise<string> =>
  await readFile(path.join(app.vaultDir, notePath), "utf-8");

describe("backfilling a path-bound action's note id", () => {
  it("keeps an action in its note's group through an in-app rename", async () => {
    const app = await bootTestApp();
    await app.client.vault.write({
      content: "# Plans\n",
      guard: { kind: "overwrite" },
      path: PLANS,
    });
    const threadId = pathOnlyThread(app, PLANS);

    await app.composed.context.threads.backfillOriginNoteIds();
    const minted = await readNote(app, PLANS);
    expect(frontmatterId(minted)).not.toBeNull();
    expect(getThread(app.db, threadId)?.originNoteId).toBe(frontmatterId(minted));

    await app.client.vault.rename({ from: PLANS, to: "archive/plans.md" });
    const listed = await app.client.threads.list({ originDocPath: "archive/plans.md" });
    expect(listed.threads.map((thread) => thread.id)).toEqual([threadId]);
    expect(listed.threads[0]?.originDocPath).toBe("archive/plans.md");
  });

  it("leaves an action whose note is gone on its path, and a rerun rewrites nothing", async () => {
    const app = await bootTestApp();
    await app.client.vault.write({
      content: "# Plans\n",
      guard: { kind: "overwrite" },
      path: PLANS,
    });
    const bound = pathOnlyThread(app, PLANS);
    const orphan = pathOnlyThread(app, "gone.md");

    await app.composed.context.threads.backfillOriginNoteIds();
    const minted = await readNote(app, PLANS);
    await app.composed.context.threads.backfillOriginNoteIds();

    expect(await readNote(app, PLANS)).toBe(minted);
    expect(getThread(app.db, bound)?.originNoteId).toBe(frontmatterId(minted));
    expect(getThread(app.db, orphan)?.originNoteId).toBeNull();
    const listed = await app.client.threads.list({ originDocPath: "gone.md" });
    expect(listed.threads.map((thread) => thread.id)).toEqual([orphan]);
  });
});
