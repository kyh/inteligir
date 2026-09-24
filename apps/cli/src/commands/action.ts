import { setTimeout as delay } from "node:timers/promises";
import {
  THREADS_LIST_DEFAULT_LIMIT,
  THREADS_LIST_MAX_LIMIT,
} from "@repo/api/local/threads/threads-schema";
import type {
  InterruptThreadResponse,
  ListThreadsQuery,
  PendingInteraction,
  Thread,
} from "@repo/api/local/threads/threads-schema";
import { defineCommand } from "citty";
import { parseBoundedInteger, parsePositiveNumber } from "../args";
import { CliExitError, failureFrom, getErrorMessage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";
import {
  DEFAULT_WAIT_POLL_INTERVAL_MS,
  DEFAULT_WAIT_TIMEOUT_SECONDS,
  MAX_WAIT_POLL_INTERVAL_MS,
  MAX_WAIT_TIMEOUT_SECONDS,
} from "../server/guide/action-wait-bounds";
import { describeInteraction } from "./describe-interaction";
import { formatThreadTimeline } from "./format-thread-timeline";

type SendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "queued"; queuedMessageId: string };

const threadLine = (thread: Thread): string => {
  const archived = thread.archivedAt === null ? "" : "  (archived)";
  const title = thread.title === null ? "" : `  ${thread.title}`;
  return `${thread.id}  ${thread.status}${title}${archived}`;
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

const describeStop = (body: InterruptThreadResponse): string => {
  switch (body.stop) {
    case "requested": {
      return `Stopping ${body.thread.id}`;
    }
    case "stopped": {
      return `Stopped ${body.thread.id}`;
    }
    case "not-running": {
      return `${body.thread.id} has no running turn`;
    }
    // no default
  }
};

const awaitingAnswer = (interactions: readonly PendingInteraction[]): string[] =>
  interactions.filter((row) => row.status === "pending").map((row) => row.id);

const answerHint = (ids: readonly string[]): string =>
  `approval ${ids.join(", ")} (\`inteligir interactions answer <id> <decision>\`)`;

// the hint is pasted back into a shell, so a value that is not one plain word is single-quoted.
const shellWord = (word: string): string =>
  /^[\w./@%+=:,-]+$/u.test(word) ? word : `'${word.replaceAll("'", String.raw`'\''`)}'`;

// the cursor names a position, not the query, so the next page is only the same listing with the same flags.
const nextPageHint = (cursor: string, request: ListThreadsQuery): string => {
  const flags = [
    `--cursor ${cursor}`,
    ...(request.includeArchived === true ? ["--archived"] : []),
    ...(request.originDocPath === undefined ? [] : [`--doc ${shellWord(request.originDocPath)}`]),
    ...(request.running === true ? ["--running"] : []),
    ...(request.limit === undefined ? [] : [`--limit ${String(request.limit)}`]),
  ];
  return `(more; pass ${flags.join(" ")} for the next page)`;
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
        meta: { description: "Archive a thread, stopping a turn it is running", name: "archive" },
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
        args: {
          archived: {
            description: "Include archived actions, listed after the rest",
            type: "boolean",
          },
          cursor: { description: "Continue where the previous page stopped", type: "string" },
          doc: { description: "Only actions attached to this note", type: "string" },
          limit: {
            description: `Page size (1–${THREADS_LIST_MAX_LIMIT}, default ${THREADS_LIST_DEFAULT_LIMIT})`,
            type: "string",
          },
          running: { description: "Only actions whose turn is running", type: "boolean" },
          ...jsonArg,
        },
        meta: { description: "Actions with status, most recently active first", name: "list" },
        run: async ({ args }) => {
          const request: ListThreadsQuery = {};
          if (args.archived === true) {
            request.includeArchived = true;
          }
          if (args.cursor !== undefined) {
            request.cursor = args.cursor;
          }
          if (args.doc !== undefined) {
            request.originDocPath = args.doc;
          }
          if (args.limit !== undefined) {
            request.limit = parseBoundedInteger(args.limit, "--limit", {
              max: THREADS_LIST_MAX_LIMIT,
              min: 1,
            });
          }
          if (args.running === true) {
            request.running = true;
          }
          const api = apiFor(deps);
          const body = await api.threads.list(request);
          if (outputJson(args, body)) {
            return;
          }
          writeLines([
            ...body.threads.map(threadLine),
            ...(body.nextCursor === null ? [] : [nextPageHint(body.nextCursor, request)]),
          ]);
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
              failureFrom(error, "SEND_FAILED"),
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
            ...(detail.pendingInteractions.length === 0
              ? []
              : [
                  "Pending interactions:",
                  ...detail.pendingInteractions
                    .flatMap(describeInteraction)
                    .map((line) => `  ${line}`),
                ]),
            ...(rendered.length > 0 ? ["", rendered] : []),
          ]);
        },
      }),

      stop: defineCommand({
        args: {
          id: { description: "The thread id", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Stop the action's running turn; a message queued behind it starts next",
          name: "stop",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.threads.interrupt({ threadId: args.id });
          if (outputJson(args, body)) {
            return;
          }
          out.success(describeStop(body));
        },
      }),

      wait: defineCommand({
        args: {
          id: { description: "The thread id", required: true, type: "positional" },
          "poll-interval": {
            description: `Poll cadence in milliseconds (default ${DEFAULT_WAIT_POLL_INTERVAL_MS}, at most ${MAX_WAIT_POLL_INTERVAL_MS})`,
            type: "string",
          },
          timeout: {
            description: `Give up after this many seconds (default ${DEFAULT_WAIT_TIMEOUT_SECONDS}, at most ${MAX_WAIT_TIMEOUT_SECONDS})`,
            type: "string",
          },
          "until-input": {
            description: "Stop with exit 4 once the thread waits on an approval",
            type: "boolean",
          },
          ...jsonArg,
        },
        meta: {
          description:
            "Block until the thread settles; exit 0 idle, 1 error, 2 timeout, 4 approval waiting (--until-input)",
          name: "wait",
        },
        run: async ({ args }) => {
          const timeoutSeconds =
            args.timeout === undefined
              ? DEFAULT_WAIT_TIMEOUT_SECONDS
              : parsePositiveNumber(args.timeout, "--timeout", { max: MAX_WAIT_TIMEOUT_SECONDS });
          const pollIntervalMs =
            args["poll-interval"] === undefined
              ? DEFAULT_WAIT_POLL_INTERVAL_MS
              : parsePositiveNumber(args["poll-interval"], "--poll-interval", {
                  max: MAX_WAIT_POLL_INTERVAL_MS,
                });
          const api = apiFor(deps);
          const deadline = Date.now() + timeoutSeconds * 1000;
          // a thread blocked on an approval is waiting on a person, so a timeout names what it was waiting on.
          let awaiting: string[] = [];
          const noticed = new Set<string>();
          const expire = (): CliExitError => {
            const blocker =
              awaiting.length === 0 ? "" : `; it is waiting on ${answerHint(awaiting)}`;
            return new CliExitError(
              `Thread ${args.id} did not settle within ${timeoutSeconds}s${blocker}`,
              { code: "WAIT_TIMEOUT" },
            );
          };
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
            const { thread: current, pendingInteractions } = await readThread(remainingMs);
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
            awaiting = awaitingAnswer(pendingInteractions);
            if (awaiting.length > 0 && args["until-input"] === true) {
              throw new CliExitError(
                `Thread ${args.id} is waiting on ${answerHint(awaiting)}; answer it, then wait again`,
                { code: "AWAITING_INTERACTION" },
              );
            }
            const fresh = awaiting.filter((id) => !noticed.has(id));
            if (fresh.length > 0 && args.json !== true) {
              out.warn(`Thread ${args.id} is waiting on ${answerHint(fresh)}; still waiting`);
            }
            for (const id of fresh) {
              noticed.add(id);
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
