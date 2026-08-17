// `inteligir interactions …` — the approvals an agent turn is parked on.
// Both leaves are ONE request against the host's own listing route; the CLI
// never walks the thread list. A resolution is validated LOCALLY against the
// shared approval grammar, so a typo names the decisions the request actually
// offers instead of reaching the host and settling as a silent deny.

import { parseApprovalResolution } from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/server-contract/threads";
import type { Command } from "commander";
import { CliExitError, invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { outputJson, requireOk, type JsonOutputOptions } from "../output";

interface ThreadScopedOptions extends JsonOutputOptions {
  thread?: string;
}

/**
 * The interaction's own payload is what says which decisions are on offer, so
 * validation needs the row. A null payload is NOT a refusal: the host is the
 * authority and will answer 400 itself — refusing here would strand a caller
 * on a grammar the server accepts.
 */
function assertResolutionValid(interaction: PendingInteraction, resolution: string): void {
  const payload = interaction.payload;
  if (payload === null) {
    return;
  }
  const parsed = parseApprovalResolution(resolution, payload);
  if (!parsed.ok) {
    throw invalidUsage(
      `${parsed.reason}. Pass a bare decision verb (${payload.availableDecisions.join(", ")}, deny) ` +
        `or the resolution JSON.`,
    );
  }
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
      const listing = await requireOk(
        await api.threads.interaction.list.$get({
          query: opts.thread === undefined ? {} : { threadId: opts.thread },
        }),
      );
      const body = await listing.json();
      if (outputJson(opts, body)) {
        return;
      }
      for (const row of body.interactions) {
        console.log(`${row.id}  ${row.threadId}  ${row.status}`);
      }
    });

  interactions
    .command("answer <id> <resolution>")
    .description("Answer one (allow_once, allow_for_session, or deny)")
    .option("--thread <id>", "The owning thread; looked up from the listing when omitted")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, resolution: string, opts: ThreadScopedOptions) => {
      const api = await apiFor(deps);
      const listing = await requireOk(
        await api.threads.interaction.list.$get({
          query: opts.thread === undefined ? {} : { threadId: opts.thread },
        }),
      );
      const listed = await listing.json();
      const interaction = listed.interactions.find((row) => row.id === id);
      if (interaction === undefined) {
        throw new CliExitError(
          opts.thread === undefined
            ? `No open interaction ${id}`
            : `No open interaction ${id} on thread ${opts.thread}`,
          { code: "not_found" },
        );
      }
      assertResolutionValid(interaction, resolution);
      const answered = await requireOk(
        await api.threads.interaction.answer.$post({
          json: { threadId: interaction.threadId, interactionId: id, resolution },
        }),
      );
      const body = await answered.json();
      if (outputJson(opts, body)) {
        return;
      }
      console.log(`Interaction ${body.interaction.id} ${body.interaction.status}`);
    });
}
