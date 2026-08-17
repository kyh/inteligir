// The delegation loop end to end under the scripted driver, over the wire
// the workspace UI drives: mint an anchor, create the bound thread, splice
// the marker into the doc through the guarded CAS write (the editor's save
// path), send the composed first message, and watch the turn settle — the
// marker on disk, the agent's write on disk, the by-doc answer carrying what
// the chip renders, and the turn on the timeline.

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
const ANCHOR = "anc_e2e_delegate";
const PROMPT = "Summarize the paragraph";
const TURN_DEADLINE_MS = 30_000;

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export const delegationScripted: Scenario = {
  name: "delegation-scripted",
  description:
    "delegate a block: anchor via CAS write, bound thread, scripted turn, chip data, timeline",
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

    ctx.log("create the bound thread");
    const created = await app.api.threads.create.$post({
      json: { title: PROMPT, originDocPath: DOC_PATH, originAnchor: ANCHOR },
    });
    expect(created.status === 201, `create answered ${created.status}`);
    const { thread } = await created.json();
    expectEq(thread.originAnchor, ANCHOR, "originAnchor");

    ctx.log("splice the marker through the guarded CAS write");
    const withMarker = insertThreadMarker(DOC, DOC.indexOf("paragraph"), ANCHOR);
    const guarded = await app.api.vault.file.$put({
      json: { path: DOC_PATH, content: withMarker, expectedHash: sha256Hex(DOC) },
    });
    expect(guarded.status === 200, `guarded write answered ${guarded.status}`);
    const onDisk = await readFile(join(app.vaultDir, DOC_PATH), "utf8");
    expectEq(onDisk, withMarker, "marker bytes on disk");
    expect(onDisk.includes(threadMarkerText(ANCHOR)), "the marker comment is in the file");

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
  },
};
