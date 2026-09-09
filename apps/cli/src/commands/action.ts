import { setTimeout as delay } from "node:timers/promises";
import { ORPCError } from "@orpc/client";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import { defineCommand } from "citty";
import { CliExitError, EXIT_WAIT_TIMEOUT, getErrorMessage, invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";
import { formatThreadTimeline } from "./format-thread-timeline";

const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;
const DEFAULT_WAIT_POLL_INTERVAL_MS = 300;

type SendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "queued"; queuedMessageId: string };

const threadLine = (thread: Thread): string => {
  const archived = thread.archivedAt === null ? "" : "  (archived)";
  const title = thread.title === null ? "" : `  ${thread.title}`;
  return `${thread.id}  ${thread.status}${title}${archived}`;
};

const parsePositiveNumber = (rawValue: string, flag: string): number => {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw invalidUsage(`${flag} must be a positive number (got "${rawValue}")`);
  }
  return value;
};

const describeSendOutcome = (outcome: SendOutcome): string => {
  switch (outcome.kind) {
    case "started": {
      return `Turn ${outcome.turnId} started`;
    }
    case "queued": {
      return `Queued (${outcome.queuedMessageId})`;
    }
    // no default
  }
};

// the re-wrap keeps the refusal's own class so a --json caller branches on the same vocabulary a bare send gives.
const sendFailureCode = (cause: unknown): string => {
  if (cause instanceof ORPCError || cause instanceof CliExitError) {
    return String(cause.code);
  }
  return "SEND_FAILED";
};

export const actionCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Agent actions — threads attached to notes", name: "action" },
    subCommands: {
      archive: defineCommand({
        args: {
          id: { description: "The thread id", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Archive a thread", name: "archive" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.threads.archive({ threadId: args.id });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Archived ${body.thread.id}`);
        },
      }),

      list: defineCommand({
        args: { ...jsonArg },
        meta: { description: "All actions with status", name: "list" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.threads.list();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(body.threads.map(threadLine));
        },
      }),

      new: defineCommand({
        args: {
          doc: { description: "Attach the action to this note", type: "string" },
          prompt: { description: "The first turn's text", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Start an action (optionally attached to a note) and send the first turn",
          name: "new",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const { thread: createdThread } = await api.threads.create(
            args.doc === undefined ? {} : { originDocPath: args.doc },
          );
          let outcome: SendOutcome;
          try {
            outcome = await api.threads.send({
              text: args.prompt,
              threadId: createdThread.id,
            });
          } catch (error) {
            // the thread exists now; failing without its id leaves one the user cannot resume or archive.
            throw new CliExitError(
              `Action ${createdThread.id} was created but its first turn failed: ${getErrorMessage(error)}. ` +
                `Retry with \`inteligir action send ${createdThread.id} …\` or archive it.`,
              { code: sendFailureCode(error) },
            );
          }
          if (outputJson(args, { send: outcome, thread: createdThread })) {
            return;
          }
          writeLines([`Action ${createdThread.id}`]);
          out.success(describeSendOutcome(outcome));
        },
      }),

      send: defineCommand({
        args: {
          id: { description: "The thread id", required: true, type: "positional" },
          prompt: { description: "The message text", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Send a follow-up; starts a turn when idle, queues behind a running one",
          name: "send",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const outcome = await api.threads.send({
            text: args.prompt,
            threadId: args.id,
          });
          if (outputJson(args, outcome)) {
            return;
          }
          out.success(describeSendOutcome(outcome));
        },
      }),

      show: defineCommand({
        args: {
          id: { description: "The thread id", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Action detail plus the compact timeline", name: "show" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const detail = await api.threads.get({ threadId: args.id });
          const timelineBody = await api.threads.timeline({ threadId: args.id });
          if (timelineBody.kind !== "full") {
            throw new CliExitError("The server answered a delta for a full timeline request", {
              code: "UNEXPECTED_RESPONSE",
            });
          }
          if (
            outputJson(args, {
              pendingInteractions: detail.pendingInteractions,
              thread: detail.thread,
              timeline: timelineBody.timeline,
            })
          ) {
            return;
          }
          const rendered = formatThreadTimeline(timelineBody.timeline);
          writeLines([
            `Thread ${detail.thread.id} — ${detail.thread.status}`,
            ...(detail.thread.title === null ? [] : [`Title: ${detail.thread.title}`]),
            ...(detail.thread.originDocPath === null
              ? []
              : [`Doc: ${detail.thread.originDocPath}`]),
            ...detail.pendingInteractions.map(
              (interaction) => `Pending interaction ${interaction.id} (${interaction.status})`,
            ),
            ...(rendered.length > 0 ? ["", rendered] : []),
          ]);
        },
      }),

      wait: defineCommand({
        args: {
          id: { description: "The thread id", required: true, type: "positional" },
          "poll-interval": {
            description: `Poll cadence in milliseconds (default ${DEFAULT_WAIT_POLL_INTERVAL_MS})`,
            type: "string",
          },
          timeout: {
            description: `Give up after this long (default ${DEFAULT_WAIT_TIMEOUT_SECONDS})`,
            type: "string",
          },
          ...jsonArg,
        },
        meta: {
          description: "Block until the thread settles; exit 0 idle, 1 error, 2 timeout",
          name: "wait",
        },
        run: async ({ args }) => {
          const timeoutSeconds =
            args.timeout === undefined
              ? DEFAULT_WAIT_TIMEOUT_SECONDS
              : parsePositiveNumber(args.timeout, "--timeout");
          const pollIntervalMs =
            args["poll-interval"] === undefined
              ? DEFAULT_WAIT_POLL_INTERVAL_MS
              : parsePositiveNumber(args["poll-interval"], "--poll-interval");
          const api = apiFor(deps);
          const deadline = Date.now() + timeoutSeconds * 1000;
          const expire = (): CliExitError =>
            new CliExitError(`Thread ${args.id} did not settle within ${timeoutSeconds}s`, {
              code: "WAIT_TIMEOUT",
              exitCode: EXIT_WAIT_TIMEOUT,
            });
          // the request carries the deadline too: a server that accepts and never answers must not park the wait past it.
          const readThread = async (remainingMs: number) => {
            try {
              return await api.threads.get(
                { threadId: args.id },
                { signal: AbortSignal.timeout(remainingMs) },
              );
            } catch (error) {
              if (Date.now() >= deadline) {
                throw expire();
              }
              throw error;
            }
          };
          for (;;) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
              throw expire();
            }
            const { thread: current } = await readThread(remainingMs);
            if (current.status === "idle") {
              if (outputJson(args, { status: current.status, threadId: args.id })) {
                return;
              }
              out.success(`Thread ${args.id} is idle.`);
              return;
            }
            if (current.status === "error") {
              throw new CliExitError(`Thread ${args.id} settled in error`, {
                code: "THREAD_ERROR",
              });
            }
            const remainingAfterPoll = deadline - Date.now();
            if (remainingAfterPoll <= 0) {
              throw expire();
            }
            await delay(Math.min(pollIntervalMs, remainingAfterPoll));
          }
        },
      }),
    },
  });
