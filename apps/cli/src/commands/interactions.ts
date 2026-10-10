import {
  pendingInteractionApprovalDecisionSchema,
  pendingInteractionApprovalDecisionValues,
  unanswerableReason,
} from "@repo/domain/pending-interactions";
import type { PendingInteractionApprovalDecision } from "@repo/domain/pending-interactions";
import type { PendingInteraction } from "@repo/contract/local/threads/threads-schema";
import { defineCommand } from "citty";
import { CliExitError, invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";
import { describeInteraction } from "./describe-interaction";

const parseDecision = (raw: string): PendingInteractionApprovalDecision => {
  const parsed = pendingInteractionApprovalDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    throw invalidUsage(
      `"${raw}" is not a decision. Pass ${pendingInteractionApprovalDecisionValues.join(", ")}.`,
    );
  }
  return parsed.data;
};

// a null payload is not a refusal: the host answers 400 itself, and refusing here would strand a decision the server accepts.
const assertAnswerable = (
  interaction: PendingInteraction,
  decision: PendingInteractionApprovalDecision,
): void => {
  const { payload } = interaction;
  const reason = payload === null ? null : unanswerableReason(payload, decision);
  if (reason !== null) {
    throw invalidUsage(`${reason}.`);
  }
};

export const interactionsCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Approvals the agent is waiting on", name: "interactions" },
    subCommands: {
      answer: defineCommand({
        args: {
          id: { description: "The interaction id", required: true, type: "positional" },
          decision: {
            description: "allow_once, allow_for_session, or deny",
            required: true,
            type: "positional",
          },
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
          const decision = parseDecision(args.decision);
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
          assertAnswerable(interaction, decision);
          const body = await api.threads.answerInteraction({
            decision,
            interactionId: args.id,
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
          writeLines(body.interactions.flatMap(describeInteraction));
        },
      }),
    },
  });
