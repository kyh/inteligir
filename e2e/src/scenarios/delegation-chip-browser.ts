// The chip renders in a real headless browser: a doc seeded WITH a marker, a
// bound thread whose scripted turn has settled, and the workspace page shows
// a `.cm-thread-chip[data-status="done"]` widget in place of the raw comment.
// Selection driving (drag-select then click the CM tooltip) is not attempted
// here — the harness CLI drives selectors, not text drags — so the create
// flow is exercised at the API level (delegation-scripted) and this scenario
// proves the browser half: marker bytes in, live chip out.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { insertThreadMarker } from "@repo/notes/markdown/thread-marker";
import { expect, skip } from "../harness/assert";
import { exec, ExecError } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const SESSION = `inteligir-e2e-chip-${process.pid}`;
const DOC_PATH = "Plans.md";
const DOC = `# Plans

First paragraph to delegate.
`;
const ANCHOR = "anc_0c81b0405e11";
const PROMPT = "Summarize the paragraph";
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

export const delegationChipBrowser: Scenario = {
  name: "delegation-chip-browser",
  description: "the delegation chip renders headless: marker bytes in, live status chip out",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      // The marker is already in the doc, so the virgin boot opens a note
      // that carries a chip; Plans.md is the only root note.
      seedVault: async (vaultDir) => {
        await writeFile(
          join(vaultDir, DOC_PATH),
          insertThreadMarker(DOC, DOC.indexOf("paragraph"), ANCHOR),
          "utf8",
        );
      },
    });

    ctx.log("create the bound thread and run its scripted turn");
    const created = await app.api.threads.create.$post({
      json: { title: PROMPT, originDocPath: DOC_PATH, originAnchor: ANCHOR },
    });
    expect(created.status === 201, `create answered ${created.status}`);
    const { thread } = await created.json();
    const send = await app.api.threads.send.$post({
      json: { threadId: thread.id, text: PROMPT, mode: "steer-if-active" },
    });
    expect(send.status === 200, `send answered ${send.status}`);
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

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", ".cm-content"], 90_000);

      ctx.log("waiting for the chip to render done");
      await agentBrowser(["wait", '.cm-thread-chip[data-status="done"]'], 90_000);

      const chipText = await agentBrowser(["get", "text", ".cm-thread-chip"]);
      expect(chipText.includes(PROMPT), `chip shows the thread title, got: ${chipText}`);
      const body = await agentBrowser(["get", "text", "body"]);
      expect(!body.includes("inteligir:thread"), "the raw marker comment is replaced by the chip");
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
