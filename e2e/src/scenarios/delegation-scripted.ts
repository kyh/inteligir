// The delegation loop end to end under the scripted driver, IN PRODUCTION
// ORDER — anchor first, thread second, turn last (chat-service.ts states why).
// The order is the point of the scenario, not an incidental detail of it: a
// version that marked the doc after creating the thread would still pass every
// assertion below while shipping the race this ordering exists to remove, so
// the scenario asserts the doc carries the marker BEFORE the thread exists,
// and that no thread was bound to the doc at that moment.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { insertThreadMarker, threadMarkerText } from "@repo/notes/markdown/thread-marker";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const DOC_PATH = "Plans.md";
const DOC = `# Plans

First paragraph to delegate.
`;
const ANCHOR = "anc_0e2e0de1e6a7";
const SECOND_ANCHOR = "anc_0e2e0de1e6b8";
const RENAMED_PATH = "Archive/Renamed Plans.md";
const PROMPT = "Summarize the paragraph";
const TURN_DEADLINE_MS = 30_000;

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export const delegationScripted: Scenario = {
  name: "delegation-scripted",
  description:
    "delegate a block in production order: anchor, thread, turn, chip data, timeline, rename-follow",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
    });

    ctx.log("seed the doc over the wire");
    const seeded = await app.api.vault.file.$put({
      json: { path: DOC_PATH, content: DOC, ifAbsent: true },
    });
    expect(seeded.status === 200, `seed write answered ${seeded.status}`);

    ctx.log("anchor FIRST: splice the marker through the guarded CAS write");
    const withMarker = insertThreadMarker(DOC, DOC.indexOf("paragraph"), ANCHOR);
    const guarded = await app.api.vault.file.$put({
      json: { path: DOC_PATH, content: withMarker, expectedHash: sha256Hex(DOC) },
    });
    expect(guarded.status === 200, `guarded write answered ${guarded.status}`);
    const onDisk = await readFile(join(app.vaultDir, DOC_PATH), "utf8");
    expectEq(onDisk, withMarker, "marker bytes on disk");
    expect(onDisk.includes(threadMarkerText(ANCHOR)), "the marker comment is in the file");

    // The ordering, asserted: the bytes are durable and NO thread is bound yet.
    const beforeCreate = await app.api.threads["by-doc"].$get({ query: { docPath: DOC_PATH } });
    expect(beforeCreate.status === 200, `by-doc answered ${beforeCreate.status}`);
    expectEq((await beforeCreate.json()).threads.length, 0, "threads bound before the create");

    ctx.log("create the bound thread");
    const created = await app.api.threads.create.$post({
      json: { title: PROMPT, originDocPath: DOC_PATH, originAnchor: ANCHOR },
    });
    expect(created.status === 201, `create answered ${created.status}`);
    const { thread } = await created.json();
    expectEq(thread.originAnchor, ANCHOR, "originAnchor");

    ctx.log("send the composed first message");
    const send = await app.api.threads.send.$post({
      json: {
        threadId: thread.id,
        text: `Do the work directly in the vault.\n\n> First paragraph to delegate.\n\nTask: ${PROMPT}`,
        mode: "steer-if-active",
      },
    });
    expect(send.status === 200, `send answered ${send.status}`);

    ctx.log("wait for the turn to settle");
    const deadline = Date.now() + TURN_DEADLINE_MS;
    for (;;) {
      const detail = await app.api.threads.get.$get({ query: { threadId: thread.id } });
      expect(detail.status === 200, `thread get answered ${detail.status}`);
      const { thread: current } = await detail.json();
      if (current.status === "idle") {
        break;
      }
      expect(current.status !== "error", "the turn settled in error");
      expect(Date.now() < deadline, `turn still "${current.status}" after ${TURN_DEADLINE_MS}ms`);
      await delay(250);
    }

    ctx.log("the scripted agent's write landed on disk");
    const agentNote = await readFile(join(app.vaultDir, "Agent", `${thread.id}.md`), "utf8");
    expect(agentNote.includes(PROMPT), "the agent note holds the sent text");

    ctx.log("by-doc answers the chip's data");
    const byDoc = await app.api.threads["by-doc"].$get({ query: { docPath: DOC_PATH } });
    expect(byDoc.status === 200, `by-doc answered ${byDoc.status}`);
    const { threads } = await byDoc.json();
    expectEq(threads.length, 1, "one bound thread");
    const activity = threads[0];
    expect(activity !== undefined, "the bound thread is present");
    expectEq(activity?.thread.id, thread.id, "the bound thread id");
    expectEq(activity?.thread.status, "idle", "settled status (chip: done)");
    expectEq(activity?.openInteractionCount, 0, "no open approvals");
    expectEq(activity?.queuedCount, 0, "no queued sends");

    ctx.log("the timeline shows the turn and its file change");
    const timeline = await app.api.threads.timeline.$get({ query: { threadId: thread.id } });
    expect(timeline.status === 200, `timeline answered ${timeline.status}`);
    const body = await timeline.json();
    expect(body.kind === "full", `expected the full timeline, got "${body.kind}"`);
    const rows = body.timeline.rows;
    const turnRow = rows.find((row) => row.kind === "turn");
    expect(turnRow !== undefined && turnRow.kind === "turn", "a turn row exists");
    expect(
      turnRow?.kind === "turn" && turnRow.status === "completed",
      "the turn row settled completed",
    );
    expect(
      turnRow?.kind === "turn" &&
        turnRow.children.some(
          (child) =>
            child.kind === "work" &&
            child.workKind === "file-change" &&
            child.changes.some((change) => change.path === `Agent/${thread.id}.md`),
        ),
      "the turn carries the agent's file change",
    );
    expect(
      rows.some((row) => row.kind === "conversation" && row.role === "assistant"),
      "the assistant answered on the timeline",
    );

    ctx.log("a second delegation on the same doc");
    const secondContent = insertThreadMarker(
      await readFile(join(app.vaultDir, DOC_PATH), "utf8"),
      0,
      SECOND_ANCHOR,
    );
    const secondWrite = await app.api.vault.file.$put({
      json: { path: DOC_PATH, content: secondContent },
    });
    expect(secondWrite.status === 200, `second marker write answered ${secondWrite.status}`);
    const secondThread = await app.api.threads.create.$post({
      json: { title: "Second", originDocPath: DOC_PATH, originAnchor: SECOND_ANCHOR },
    });
    expect(secondThread.status === 201, `second create answered ${secondThread.status}`);

    ctx.log("renaming the doc FOLLOWS every delegation bound to it");
    const renamed = await app.api.vault.rename.$post({
      json: { from: DOC_PATH, to: RENAMED_PATH },
    });
    expect(renamed.status === 200, `rename answered ${renamed.status}`);

    // The markers travelled with the bytes...
    const movedBytes = await readFile(join(app.vaultDir, RENAMED_PATH), "utf8");
    expect(movedBytes.includes(threadMarkerText(ANCHOR)), "the first marker moved with the file");
    expect(
      movedBytes.includes(threadMarkerText(SECOND_ANCHOR)),
      "the second marker moved with the file",
    );

    // ...and so did both threads' origins, so every chip still resolves.
    const oldPath = await app.api.threads["by-doc"].$get({ query: { docPath: DOC_PATH } });
    expect(oldPath.status === 200, `by-doc(old) answered ${oldPath.status}`);
    expectEq((await oldPath.json()).threads.length, 0, "threads still bound to the old path");

    const newPath = await app.api.threads["by-doc"].$get({ query: { docPath: RENAMED_PATH } });
    expect(newPath.status === 200, `by-doc(new) answered ${newPath.status}`);
    const rebound = (await newPath.json()).threads;
    expectEq(rebound.length, 2, "threads rebound to the new path");
    const reboundAnchors = rebound
      .map((activity) => activity.thread.originAnchor)
      .filter((anchor): anchor is string => anchor !== null)
      .toSorted();
    expectEq(
      reboundAnchors.join(","),
      [ANCHOR, SECOND_ANCHOR].toSorted().join(","),
      "both anchors resolve at the new path",
    );
  },
};
