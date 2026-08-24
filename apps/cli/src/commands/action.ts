// `inteligir action …` — the agent surface: create/send, the compact
// timeline, and the poll-until-settled `wait` whose exit code is the outcome
// (0 idle, 1 error, 2 timeout) so a shell script can branch on it.

import { setTimeout as delay } from "node:timers/promises";
import type { Thread } from "@repo/server-contract/threads";
import { formatThreadTimeline } from "@repo/thread-view/format-thread-timeline";
import { defineCommand } from "citty";
import { CliExitError, EXIT_WAIT_TIMEOUT, invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, requireOk, writeLines } from "../output";

const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;
const DEFAULT_WAIT_POLL_INTERVAL_MS = 300;

type SendOutcome =
  | { kind: "started" | "steered"; turnId: string }
  | { kind: "queued"; queuedMessageId: string };

function threadLine(thread: Thread): string {
  const archived = thread.archivedAt === null ? "" : "  (archived)";
  const title = thread.title === null ? "" : `  ${thread.title}`;
  return `${thread.id}  ${thread.status}${title}${archived}`;
}

function parsePositiveNumber(rawValue: string, flag: string): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw invalidUsage(`${flag} must be a positive number (got "${rawValue}")`);
  }
  return value;
}

function describeSendOutcome(outcome: SendOutcome): string {
  switch (outcome.kind) {
    case "started":
      return `Turn ${outcome.turnId} started`;
    case "steered":
      return `Steered active turn ${outcome.turnId}`;
    case "queued":
      return `Queued (${outcome.queuedMessageId})`;
  }
}

export function actionCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "action", description: "Agent actions — threads attached to notes" },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "All actions with status" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await (await requireOk(await api.threads.list.$get())).json();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(body.threads.map(threadLine));
        },
      }),

      new: defineCommand({
        meta: {
          name: "new",
          description: "Start an action (optionally attached to a note) and send the first turn",
        },
        args: {
          prompt: { type: "positional", required: true, description: "The first turn's text" },
          doc: { type: "string", description: "Attach the action to this note" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const created = await requireOk(
            await api.threads.create.$post({
              json: args.doc === undefined ? {} : { originDocPath: args.doc },
            }),
          );
          const { thread: createdThread } = await created.json();
          let outcome: SendOutcome;
          try {
            const sent = await requireOk(
              await api.threads.send.$post({
                json: { threadId: createdThread.id, text: args.prompt, mode: "steer-if-active" },
              }),
            );
            outcome = await sent.json();
          } catch (error) {
            // The thread EXISTS now. Failing without naming it would leave an
            // empty thread the user cannot resume or archive because they never
            // learned its id.
            const detail = error instanceof CliExitError ? error.message : String(error);
            throw new CliExitError(
              `Action ${createdThread.id} was created but its first turn failed: ${detail}. ` +
                `Retry with \`inteligir action send ${createdThread.id} …\` or archive it.`,
              { code: error instanceof CliExitError ? error.code : "send_failed" },
            );
          }
          if (outputJson(args, { thread: createdThread, send: outcome })) {
            return;
          }
          writeLines([`Action ${createdThread.id}`]);
          out.success(describeSendOutcome(outcome));
        },
      }),

      send: defineCommand({
        meta: {
          name: "send",
          description: "Send a follow-up; steers the active turn unless --queue",
        },
        args: {
          id: { type: "positional", required: true, description: "The thread id" },
          prompt: { type: "positional", required: true, description: "The message text" },
          queue: {
            type: "boolean",
            description: "Queue behind the active turn instead of steering it",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const sent = await requireOk(
            await api.threads.send.$post({
              json: {
                threadId: args.id,
                text: args.prompt,
                mode: args.queue === true ? "queue-if-active" : "steer-if-active",
              },
            }),
          );
          const outcome = await sent.json();
          if (outputJson(args, outcome)) {
            return;
          }
          out.success(describeSendOutcome(outcome));
        },
      }),

      show: defineCommand({
        meta: { name: "show", description: "Action detail plus the compact timeline" },
        args: {
          id: { type: "positional", required: true, description: "The thread id" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const detail = await (
            await requireOk(await api.threads.get.$get({ query: { threadId: args.id } }))
          ).json();
          const timelineResponse = await requireOk(
            await api.threads.timeline.$get({ query: { threadId: args.id } }),
          );
          const timelineBody = await timelineResponse.json();
          if (timelineBody.kind !== "full") {
            throw new CliExitError("The server answered a delta for a full timeline request", {
              code: "unexpected_response",
            });
          }
          if (
            outputJson(args, {
              thread: detail.thread,
              pendingInteractions: detail.pendingInteractions,
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
              : [`Doc: ${detail.thread.originDocPath} @ ${detail.thread.originAnchor ?? ""}`]),
            ...detail.pendingInteractions.map(
              (interaction) => `Pending interaction ${interaction.id} (${interaction.status})`,
            ),
            ...(rendered.length > 0 ? ["", rendered] : []),
          ]);
        },
      }),

      wait: defineCommand({
        meta: {
          name: "wait",
          description: "Block until the thread settles; exit 0 idle, 1 error, 2 timeout",
        },
        args: {
          id: { type: "positional", required: true, description: "The thread id" },
          timeout: {
            type: "string",
            description: `Give up after this long (default ${DEFAULT_WAIT_TIMEOUT_SECONDS})`,
          },
          "poll-interval": {
            type: "string",
            description: `Poll cadence in milliseconds (default ${DEFAULT_WAIT_POLL_INTERVAL_MS})`,
          },
          ...jsonArg,
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
          const deadline = Date.now() + timeoutSeconds * 1_000;
          const expire = (): CliExitError =>
            new CliExitError(`Thread ${args.id} did not settle within ${timeoutSeconds}s`, {
              code: "wait_timeout",
              exitCode: EXIT_WAIT_TIMEOUT,
            });
          for (;;) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
              throw expire();
            }
            // --timeout is a WALL-CLOCK bound, so the request carries it too: a
            // server that accepts the connection and never answers must not park
            // the wait past its deadline.
            const response = await api.threads.get
              .$get(
                { query: { threadId: args.id } },
                { init: { signal: AbortSignal.timeout(remainingMs) } },
              )
              .catch((cause: unknown) => {
                if (Date.now() >= deadline) {
                  throw expire();
                }
                throw cause;
              });
            const { thread: current } = await (await requireOk(response)).json();
            if (current.status === "idle") {
              if (outputJson(args, { threadId: args.id, status: current.status })) {
                return;
              }
              out.success(`Thread ${args.id} is idle.`);
              return;
            }
            if (current.status === "error") {
              throw new CliExitError(`Thread ${args.id} settled in error`, {
                code: "thread_error",
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

      archive: defineCommand({
        meta: { name: "archive", description: "Archive a thread" },
        args: {
          id: { type: "positional", required: true, description: "The thread id" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const archived = await requireOk(
            await api.threads.archive.$post({ json: { threadId: args.id } }),
          );
          const body = await archived.json();
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Archived ${body.thread.id}`);
        },
      }),
    },
  });
}
