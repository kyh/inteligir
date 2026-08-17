// `inteligir thread …` — the agent surface: create/send, the compact
// timeline, and the poll-until-settled `wait` whose exit code is the outcome
// (0 idle, 1 error, 2 timeout) so a shell script can branch on it.

import { setTimeout as delay } from "node:timers/promises";
import type { Thread } from "@repo/server-contract/threads";
import { formatThreadTimeline } from "@repo/thread-view/format-thread-timeline";
import type { Command } from "commander";
import { CliExitError, EXIT_WAIT_TIMEOUT, invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { outputJson, requireOk, type JsonOutputOptions } from "../output";

const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;
const DEFAULT_WAIT_POLL_INTERVAL_MS = 300;

interface NewOptions extends JsonOutputOptions {
  doc?: string;
  anchor?: string;
}

interface SendOptions extends JsonOutputOptions {
  queue?: boolean;
}

interface WaitOptions extends JsonOutputOptions {
  timeout?: string;
  pollInterval?: string;
}

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

export function registerThreadCommands(program: Command, deps: CliDeps): void {
  const thread = program.command("thread").description("Agent threads");

  thread
    .command("list")
    .description("All threads with status")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const body = await (await requireOk(await api.threads.list.$get())).json();
      if (outputJson(opts, body)) {
        return;
      }
      for (const row of body.threads) {
        console.log(threadLine(row));
      }
    });

  thread
    .command("new <prompt>")
    .description("Create a thread (optionally bound to a doc anchor) and send the first turn")
    .option("--doc <path>", "Bind the thread to this doc (requires --anchor)")
    .option("--anchor <anchor>", "The block anchor inside --doc")
    .option("--json", "Print machine-readable JSON output")
    .action(async (prompt: string, opts: NewOptions) => {
      if ((opts.doc === undefined) !== (opts.anchor === undefined)) {
        throw invalidUsage("--doc and --anchor must be provided together");
      }
      const api = await apiFor(deps);
      const created = await requireOk(
        await api.threads.create.$post({
          json:
            opts.doc === undefined || opts.anchor === undefined
              ? {}
              : { originDocPath: opts.doc, originAnchor: opts.anchor },
        }),
      );
      const { thread: createdThread } = await created.json();
      let outcome: SendOutcome;
      try {
        const sent = await requireOk(
          await api.threads.send.$post({
            json: { threadId: createdThread.id, text: prompt, mode: "steer-if-active" },
          }),
        );
        outcome = await sent.json();
      } catch (error) {
        // The thread EXISTS now. Failing without naming it would leave an
        // empty thread the user cannot resume or archive because they never
        // learned its id.
        const detail = error instanceof CliExitError ? error.message : String(error);
        throw new CliExitError(
          `Thread ${createdThread.id} was created but its first turn failed: ${detail}. ` +
            `Retry with \`inteligir thread send ${createdThread.id} …\` or archive it.`,
          { code: error instanceof CliExitError ? error.code : "send_failed" },
        );
      }
      if (outputJson(opts, { thread: createdThread, send: outcome })) {
        return;
      }
      console.log(`Thread ${createdThread.id}`);
      console.log(describeSendOutcome(outcome));
    });

  thread
    .command("send <id> <prompt>")
    .description("Send a follow-up; steers the active turn unless --queue")
    .option("--queue", "Queue behind the active turn instead of steering it")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, prompt: string, opts: SendOptions) => {
      const api = await apiFor(deps);
      const sent = await requireOk(
        await api.threads.send.$post({
          json: {
            threadId: id,
            text: prompt,
            mode: opts.queue === true ? "queue-if-active" : "steer-if-active",
          },
        }),
      );
      const outcome = await sent.json();
      if (outputJson(opts, outcome)) {
        return;
      }
      console.log(describeSendOutcome(outcome));
    });

  thread
    .command("show <id>")
    .description("Thread detail plus the compact timeline")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const detail = await (
        await requireOk(await api.threads.get.$get({ query: { threadId: id } }))
      ).json();
      const timelineResponse = await requireOk(
        await api.threads.timeline.$get({ query: { threadId: id } }),
      );
      const timelineBody = await timelineResponse.json();
      if (timelineBody.kind !== "full") {
        throw new CliExitError("The server answered a delta for a full timeline request", {
          code: "unexpected_response",
        });
      }
      if (
        outputJson(opts, {
          thread: detail.thread,
          pendingInteractions: detail.pendingInteractions,
          timeline: timelineBody.timeline,
        })
      ) {
        return;
      }
      console.log(`Thread ${detail.thread.id} — ${detail.thread.status}`);
      if (detail.thread.title !== null) {
        console.log(`Title: ${detail.thread.title}`);
      }
      if (detail.thread.originDocPath !== null) {
        console.log(`Doc: ${detail.thread.originDocPath} @ ${detail.thread.originAnchor ?? ""}`);
      }
      for (const interaction of detail.pendingInteractions) {
        console.log(`Pending interaction ${interaction.id} (${interaction.status})`);
      }
      const rendered = formatThreadTimeline(timelineBody.timeline);
      if (rendered.length > 0) {
        console.log("");
        console.log(rendered);
      }
    });

  thread
    .command("wait <id>")
    .description("Block until the thread settles; exit 0 idle, 1 error, 2 timeout")
    .option(
      "--timeout <seconds>",
      `Give up after this long (default ${DEFAULT_WAIT_TIMEOUT_SECONDS})`,
    )
    .option(
      "--poll-interval <ms>",
      `Poll cadence in milliseconds (default ${DEFAULT_WAIT_POLL_INTERVAL_MS})`,
    )
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, opts: WaitOptions) => {
      const timeoutSeconds =
        opts.timeout === undefined
          ? DEFAULT_WAIT_TIMEOUT_SECONDS
          : parsePositiveNumber(opts.timeout, "--timeout");
      const pollIntervalMs =
        opts.pollInterval === undefined
          ? DEFAULT_WAIT_POLL_INTERVAL_MS
          : parsePositiveNumber(opts.pollInterval, "--poll-interval");
      const api = await apiFor(deps);
      const deadline = Date.now() + timeoutSeconds * 1_000;
      const expire = (): CliExitError =>
        new CliExitError(`Thread ${id} did not settle within ${timeoutSeconds}s`, {
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
          .$get({ query: { threadId: id } }, { init: { signal: AbortSignal.timeout(remainingMs) } })
          .catch((error: unknown) => {
            if (Date.now() >= deadline) {
              throw expire();
            }
            throw error;
          });
        const { thread: current } = await (await requireOk(response)).json();
        if (current.status === "idle") {
          if (outputJson(opts, { threadId: id, status: current.status })) {
            return;
          }
          console.log(`Thread ${id} is idle.`);
          return;
        }
        if (current.status === "error") {
          throw new CliExitError(`Thread ${id} settled in error`, { code: "thread_error" });
        }
        const remainingAfterPoll = deadline - Date.now();
        if (remainingAfterPoll <= 0) {
          throw expire();
        }
        await delay(Math.min(pollIntervalMs, remainingAfterPoll));
      }
    });

  thread
    .command("archive <id>")
    .description("Archive a thread")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const archived = await requireOk(await api.threads.archive.$post({ json: { threadId: id } }));
      const body = await archived.json();
      if (outputJson(opts, body)) {
        return;
      }
      console.log(`Archived ${body.thread.id}`);
    });
}
