import { parseApprovalResolution } from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";
import { defineCommand } from "citty";
import { CliExitError, invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

// a null payload is not a refusal: the host answers 400 itself, and refusing here would strand a grammar the server accepts.
const assertResolutionValid = (interaction: PendingInteraction, resolution: string): void => {
  const { payload } = interaction;
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
};

export const interactionsCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Approvals the agent is waiting on", name: "interactions" },
    subCommands: {
      answer: defineCommand({
        args: {
          id: { description: "The interaction id", required: true, type: "positional" },
          resolution: { description: "The decision", required: true, type: "positional" },
          thread: {
            description: "The owning thread; looked up from the listing when omitted",
            type: "string",
          },
          ...jsonArg,
        },
        meta: {
          description: "Answer one (allow_once, allow_for_session, or deny)",
          name: "answer",
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
              { code: "NOT_FOUND" },
            );
          }
          assertResolutionValid(interaction, args.resolution);
          const body = await api.threads.answerInteraction({
            interactionId: args.id,
            resolution: args.resolution,
            threadId: interaction.threadId,
          });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Interaction ${body.interaction.id} ${body.interaction.status}`);
        },
      }),

      list: defineCommand({
        args: {
          thread: { description: "Only this thread's interactions", type: "string" },
          ...jsonArg,
        },
        meta: { description: "Pending approval requests", name: "list" },
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
    },
  });
