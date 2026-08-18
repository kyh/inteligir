// The agent edits the note the user has open, and the buffer SAYS SO.
//
// Every hop is production code: the scripted driver writes through the vault
// service, the watcher fires, the ws doc invalidation lands, the note's reader
// re-reads, the controller adopts into the buffer through `replaceDoc` — and
// that transaction's `externalReplaceAnnotation` is what the attribution marks
// read. Nothing here reaches into the editor; the tint has to arrive on its
// own or the chain is broken somewhere along it.
//
// The unit suite can drive `replaceDoc` directly, so it proves the decoration
// and never that a write on disk reaches it.

import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { expect, expectEq, skip } from "../harness/assert";
import { exec, ExecError } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const SESSION = `inteligir-e2e-external-edit-${process.pid}`;
const PROMPT = "rewrite the note";
const BASE_NOTE = "# Agent note\n\nthe line that was already here\n";
const TURN_DEADLINE_MS = 30_000;

async function agentBrowser(args: readonly string[], timeoutMs = 60_000): Promise<string> {
  const result = await exec("agent-browser", ["--session", SESSION, ...args], { timeoutMs });
  return result.stdout.trim();
}

function describeExecError(error: unknown): string {
  if (error instanceof ExecError) {
    return [error.message, error.stdout.trim(), error.stderr.trim()]
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

export const externalEditBrowser: Scenario = {
  name: "external-edit-browser",
  description: "an agent write into the OPEN note is attributed in the buffer",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
    });

    ctx.log("create the thread whose scripted turn owns a note path");
    const created = await app.api.threads.create.$post({ json: { title: PROMPT } });
    expect(created.status === 201, `create answered ${created.status}`);
    const { thread } = await created.json();
    // The scripted driver writes exactly here; seeding it first makes the
    // turn a MODIFICATION, which is the case with hunks to attribute.
    const notePath = `Agent/${thread.id}.md`;
    const seeded = await app.api.vault.file.$put({
      json: { path: notePath, content: BASE_NOTE, ifAbsent: true },
    });
    expect(seeded.status === 200, `note seed answered ${seeded.status}`);

    try {
      ctx.log("probing the environment: can a headless browser launch at all?");
      try {
        await agentBrowser(["open", "about:blank"], 120_000);
      } catch (error) {
        skip(
          `agent-browser could not launch a headless browser in this environment; ` +
            `the exact error:\n${describeExecError(error)}`,
        );
      }

      // The open note rides the route's `note` search param — deep-linkable,
      // which is what lets this scenario open a note in a subdirectory.
      const url = `${app.baseUrl}/?note=${encodeURIComponent(notePath)}`;
      ctx.log(`opening ${url}`);
      await agentBrowser(["open", url], 60_000);
      await agentBrowser(["wait", ".cm-content"], 90_000);
      const opened = await agentBrowser(["get", "text", ".cm-content"]);
      expect(
        opened.includes("the line that was already here"),
        `the browser did not open ${notePath} — got: ${opened}`,
      );

      ctx.log("run the turn: the agent rewrites the note under the caret");
      const send = await app.api.threads.send.$post({
        json: { threadId: thread.id, text: PROMPT, mode: "steer-if-active" },
      });
      expect(send.status === 200, `send answered ${send.status}`);

      ctx.log("the buffer attributes the write on its own");
      await agentBrowser(["wait", ".cm-external-edit"], TURN_DEADLINE_MS);
      const attributed = await agentBrowser([
        "eval",
        "[...document.querySelectorAll('.cm-content .cm-external-edit')].map((n) => n.textContent).join(' ')",
      ]);
      expect(
        attributed.includes(PROMPT),
        `the tint does not cover what the agent wrote — got: ${attributed}`,
      );

      ctx.log("the buffer holds the agent's bytes, and so does the file");
      const deadline = Date.now() + TURN_DEADLINE_MS;
      for (;;) {
        const onDisk = await readFile(join(app.vaultDir, notePath), "utf8");
        if (onDisk.includes(PROMPT)) {
          expect(
            !onDisk.includes("the line that was already here"),
            `the agent's write did not replace the base:\n${onDisk}`,
          );
          break;
        }
        expect(Date.now() < deadline, `the agent's write never reached disk:\n${onDisk}`);
        await delay(250);
      }
      const buffer = await agentBrowser(["get", "text", ".cm-content"]);
      expect(buffer.includes(PROMPT), `the buffer never took the write — got: ${buffer}`);

      ctx.log("the attribution is a decoration, not bytes");
      expectEq(
        (await readFile(join(app.vaultDir, notePath), "utf8")).includes("cm-external-edit"),
        false,
        "the tint wrote itself into the file",
      );
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
