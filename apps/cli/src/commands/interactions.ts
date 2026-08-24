// `inteligir interactions …` — the approvals an agent turn is parked on.
// Both leaves are ONE request against the host's own listing route; the CLI
// never walks the thread list. A resolution is validated LOCALLY against the
// shared approval grammar, so a typo names the decisions the request actually
// offers instead of reaching the host and settling as a silent deny.

import { parseApprovalResolution } from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";
import { defineCommand } from "citty";
import { CliExitError, invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

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

export function interactionsCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "interactions", description: "Approvals the agent is waiting on" },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "Pending approval requests" },
        args: {
          thread: { type: "string", description: "Only this thread's interactions" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.threads.listInteractions(
            args.thread === undefined ? {} : { threadId: args.thread },
          );
          if (outputJson(args, body)) {
            return;
          }
          writeLines(body.interactions.map((row) => `${row.id}  ${row.threadId}  ${row.status}`));
        },
      }),

      answer: defineCommand({
        meta: {
          name: "answer",
          description: "Answer one (allow_once, allow_for_session, or deny)",
        },
        args: {
          id: { type: "positional", required: true, description: "The interaction id" },
          resolution: { type: "positional", required: true, description: "The decision" },
          thread: {
            type: "string",
            description: "The owning thread; looked up from the listing when omitted",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const listed = await api.threads.listInteractions(
            args.thread === undefined ? {} : { threadId: args.thread },
          );
          const interaction = listed.interactions.find((row) => row.id === args.id);
          if (interaction === undefined) {
            throw new CliExitError(
              args.thread === undefined
                ? `No open interaction ${args.id}`
                : `No open interaction ${args.id} on thread ${args.thread}`,
              { code: "not_found" },
            );
          }
          assertResolutionValid(interaction, args.resolution);
          const body = await api.threads.answerInteraction({
            threadId: interaction.threadId,
            interactionId: args.id,
            resolution: args.resolution,
          });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Interaction ${body.interaction.id} ${body.interaction.status}`);
        },
      }),
    },
  });
}
