// `inteligir interactions …` — the approvals an agent turn is parked on.
// There is no global interactions route (an interaction belongs to a thread),
// so the unscoped listing folds the per-thread details; `answer` locates the
// owning thread the same way when --thread is not given.

import type { ApiClient } from "@repo/server-contract/client";
import type { PendingInteraction } from "@repo/server-contract/threads";
import type { Command } from "commander";
import { CliExitError } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { failFromResponse, outputJson, type JsonOutputOptions } from "../output";

interface ThreadScopedOptions extends JsonOutputOptions {
  thread?: string;
}

async function interactionsForThread(
  api: ApiClient,
  threadId: string,
): Promise<PendingInteraction[]> {
  const response = await api.threads.get.$get({ query: { threadId } });
  if (response.status !== 200) {
    return failFromResponse(response);
  }
  return (await response.json()).pendingInteractions;
}

async function collectInteractions(
  api: ApiClient,
  threadId: string | undefined,
): Promise<PendingInteraction[]> {
  if (threadId !== undefined) {
    return interactionsForThread(api, threadId);
  }
  const listResponse = await api.threads.list.$get();
  const { threads } = await listResponse.json();
  const collected: PendingInteraction[] = [];
  for (const thread of threads) {
    collected.push(...(await interactionsForThread(api, thread.id)));
  }
  return collected;
}

export function registerInteractionsCommands(program: Command, deps: CliDeps): void {
  const interactions = program
    .command("interactions")
    .description("Approvals the agent is waiting on");

  interactions
    .command("list")
    .description("Pending approval requests")
    .option("--thread <id>", "Only this thread's interactions")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: ThreadScopedOptions) => {
      const api = await apiFor(deps);
      const rows = await collectInteractions(api, opts.thread);
      if (outputJson(opts, { interactions: rows })) {
        return;
      }
      for (const row of rows) {
        console.log(`${row.id}  ${row.threadId}  ${row.status}`);
      }
    });

  interactions
    .command("answer <id> <resolution>")
    .description("Answer one (allow_once, allow_for_session, or deny)")
    .option("--thread <id>", "The owning thread (located by scanning when omitted)")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, resolution: string, opts: ThreadScopedOptions) => {
      const api = await apiFor(deps);
      let threadId = opts.thread;
      if (threadId === undefined) {
        const rows = await collectInteractions(api, undefined);
        threadId = rows.find((row) => row.id === id)?.threadId;
        if (threadId === undefined) {
          throw new CliExitError(`No thread holds interaction ${id} — pass --thread <id>`);
        }
      }
      const response = await api.threads.interaction.answer.$post({
        json: { threadId, interactionId: id, resolution },
      });
      if (response.status !== 200) {
        return failFromResponse(response);
      }
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      console.log(`Interaction ${body.interaction.id} ${body.interaction.status}`);
    });
}
