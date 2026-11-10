// One conversation with the built-in agent: a SQLite Durable Object of its own, named
// `agent-thread:<accountId>:<threadId>` by its account's cell (`./thread-stub`), which alone
// reaches it, and reaching that cell alone back, by the account its own name holds. Its loop
// (`./thread-loop`) runs on the Agents SDK's Lifecycle, its durable job queue and its one alarm,
// and on nothing else of the SDK: a `drive` job starts the work detached from the alarm's dispatch
// unless this instance runs it already, and stays, re-timed every 30 seconds, as the watchdog that
// brings a dead instance's work back and cuts a reply gone silent in a live one; an approval waits
// under a job that denies it at ten minutes; a push the cell could not take waits under the
// `outbox` job. Every job is pushed to run once, its outcome returned rather than thrown, since
// Lifecycle retries a job three times in process by default. A fresh instance holds no work, so
// every `drive` job it finds is an orphan, woken at once. Each RPC starts the lifecycle, as native
// RPC needs, and is safe to repeat. A cell that answers that it holds no such thread has the object
// purge itself. Its schema is migrated in the constructor, before Lifecycle's first job makes its
// own table, which a later migration would take for tables drizzle did not make.

import type Anthropic from "@anthropic-ai/sdk";
import { Lifecycle } from "agents/lifecycle";
import type { LifecycleJobContext, LifecycleJobOutcome } from "agents/lifecycle";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { libraryCell } from "../library/library-cell";
import { errorFields } from "../log";
import { openWithSchema } from "../object-schema";
import { anthropicClient } from "./anthropic-client";
import { migrateThread, threadDbOf } from "./thread-db";
import {
  acceptDelivery,
  cutSilentCalls,
  decideCall,
  drainOutbox,
  inspectThread,
  listeningFetch,
  requestCancel,
  rulesHashOf,
  step,
} from "./thread-loop";
import type { CallInFlight, ThreadHost } from "./thread-loop";
import { deployedDefinition } from "./thread-request";
import { deliveryRequestSchema, respondRequestSchema } from "./thread-wire";
import type { DeliveryRequest, RespondRequest, ThreadInspection } from "./thread-wire";

export const AGENT_THREAD_PREFIX = "agent-thread:";

// the watchdog's beat: a drive job comes due this long after its last dispatch while work is open
const WATCHDOG_MS = 30_000;
// a job whose work threw unexpectedly is asked for again this long after
const AGAIN_MS = 30_000;

const DRIVE_JOB = "drive";
const OUTBOX_JOB = "outbox";
const approvalJob = (toolUseId: string): string => `approval:${toolUseId}`;

// every job runs once a dispatch: the loop answers its own failures
const ONCE = { maxAttempts: 1 } as const;

const approvalPayloadSchema = z.object({ toolUseId: z.string().min(1) });

// the account and the thread an object's name holds; an object reached by any other name is a bug
const threadNameOf = (name: string | undefined) => {
  const rest =
    name?.startsWith(AGENT_THREAD_PREFIX) === true ? name.slice(AGENT_THREAD_PREFIX.length) : "";
  const split = rest.lastIndexOf(":");
  if (split <= 0 || split === rest.length - 1) {
    throw new Error("a conversation's object is named agent-thread:<accountId>:<threadId>");
  }
  return { accountId: rest.slice(0, split), threadId: rest.slice(split + 1) };
};

export class AgentThreadDO extends DurableObject<Env> {
  // annotated, not inferred from `this`: the generated `Env` is read from cloudflare.config.ts,
  // which types this class through the Worker's entry, so inferring it here would ask for `Env`
  // while `Env` is being made, and the checker settles that with an `Env` short of its bindings
  readonly lifecycle: Lifecycle<Env> = Lifecycle.install(this);

  // this instance: a model call stamped with another was made by an instance that died
  readonly #isolate = crypto.randomUUID();
  readonly #calls = new Map<number, CallInFlight>();
  #driving: Promise<void> | null = null;
  // asked for more while the work ran, so the work goes on rather than resting
  #again = false;
  #purged = false;
  #client: Anthropic | null | undefined;
  readonly #db = threadDbOf(this.ctx.storage);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    openWithSchema(ctx, "thread", migrateThread);
  }

  #host(): ThreadHost {
    const { accountId, threadId } = threadNameOf(this.ctx.id.name);
    const { jobs } = this.lifecycle;
    return {
      calls: this.#calls,
      cell: () => libraryCell(this.ctx.exports, accountId),
      db: this.#db,
      client: () => {
        this.#client ??= anthropicClient(
          this.env,
          accountId,
          listeningFetch(this.#calls, Date.now),
        );
        return this.#client;
      },
      definition: deployedDefinition,
      isolate: this.#isolate,
      jobs: {
        approvalAt: async (toolUseId, at) => {
          await jobs.push({
            fn: "approval",
            id: approvalJob(toolUseId),
            payload: { toolUseId },
            retry: ONCE,
            time: at,
          });
        },
        driveAt: async (at) => {
          await jobs.push({ fn: DRIVE_JOB, id: DRIVE_JOB, retry: ONCE, time: at });
        },
        dropApproval: async (toolUseId) => {
          await jobs.cancel(approvalJob(toolUseId));
        },
        outboxAt: async (at) => {
          await jobs.push({ fn: OUTBOX_JOB, id: OUTBOX_JOB, retry: ONCE, time: at });
        },
      },
      now: Date.now,
      purge: async () => {
        await this.#purge();
      },
      threadId,
      transaction: (work) => this.ctx.storage.transactionSync(work),
    };
  }

  // ---- Lifecycle's hooks ----

  async onStart(): Promise<void> {
    for (const job of this.lifecycle.jobs.list()) {
      if (job.fn === DRIVE_JOB) {
        await this.lifecycle.jobs.reschedule(job.id, Date.now());
      }
    }
  }

  async onJob({ job }: LifecycleJobContext): Promise<LifecycleJobOutcome> {
    if (this.#purged) {
      return undefined;
    }
    try {
      switch (job.fn) {
        case DRIVE_JOB: {
          return this.#kick();
        }
        case OUTBOX_JOB: {
          await drainOutbox(this.#host());
          return undefined;
        }
        case "approval": {
          const { toolUseId } = approvalPayloadSchema.parse(job.payload);
          const host = this.#host();
          if (await decideCall(host, { approved: false, by: "timeout", reason: null, toolUseId })) {
            await this.#wake();
          }
          return undefined;
        }
        default: {
          return undefined;
        }
      }
    } catch (error) {
      console.error({ event: "agent-thread-job-failed", job: job.fn, ...errorFields(error) });
      return { rescheduleAt: Date.now() + AGAIN_MS };
    }
  }

  // ---- the loop ----

  // the work started, unless this instance runs it already, where a reply gone silent is cut for
  // the loop to send again; the job stays as the watchdog
  #kick(): LifecycleJobOutcome {
    if (this.#driving === null) {
      const work = this.#driveThenRest();
      this.#driving = work;
      this.lifecycle.trackAlarmWork(work);
    } else {
      cutSilentCalls(this.#calls, Date.now());
    }
    return { rescheduleAt: Date.now() + WATCHDOG_MS };
  }

  async #driveThenRest(): Promise<void> {
    try {
      await this.#drive();
    } finally {
      this.#driving = null;
    }
  }

  async #drive(): Promise<void> {
    const host = this.#host();
    for (;;) {
      this.#again = false;
      let result: Awaited<ReturnType<typeof step>>;
      try {
        result = await step(host);
      } catch (error) {
        console.error({ event: "agent-thread-step-failed", ...errorFields(error) });
        await host.jobs.driveAt(Date.now() + AGAIN_MS);
        return;
      }
      if (result === "continue" || ((result === "idle" || result === "paused") && this.#again)) {
        continue;
      }
      if (result === "idle" || result === "paused") {
        // nothing to do until something new happens, which pushes the job again
        await this.lifecycle.jobs.cancel(DRIVE_JOB);
      }
      return;
    }
  }

  // durable intent first: the drive job is the record that this thread has work
  async #wake(): Promise<void> {
    this.#again = true;
    await this.lifecycle.jobs.push({ fn: DRIVE_JOB, id: DRIVE_JOB, retry: ONCE, time: Date.now() });
  }

  async #purge(): Promise<void> {
    if (this.#purged) {
      return;
    }
    this.#purged = true;
    for (const call of this.#calls.values()) {
      call.abort.abort(new Error("The conversation was deleted."));
    }
    await this.lifecycle.disableAlarms();
    await this.ctx.storage.deleteAll();
  }

  // ---- what the cell asks ----

  // a turn handed in: kept once by its op id, and the work woken
  async send(request: DeliveryRequest): Promise<void> {
    await this.lifecycle.start();
    const delivery = deliveryRequestSchema.parse(request);
    if (this.#purged || delivery.threadId !== threadNameOf(this.ctx.id.name).threadId) {
      return;
    }
    acceptDelivery(this.#host(), delivery, await rulesHashOf(delivery.rules));
    await this.#wake();
  }

  // the person's answer to a call waiting on them, decided once
  async respond(request: RespondRequest): Promise<void> {
    await this.lifecycle.start();
    if (this.#purged) {
      return;
    }
    const answer = respondRequestSchema.parse(request);
    const decided = await decideCall(this.#host(), {
      approved: answer.approved,
      by: "person",
      reason: answer.reason,
      toolUseId: answer.toolUseId,
    });
    if (decided) {
      await this.#wake();
    }
  }

  // the turn stopped: marked durably, its stream cut, its calls answered by the next step
  async cancel(request: { readonly turn: number }): Promise<void> {
    await this.lifecycle.start();
    if (this.#purged) {
      return;
    }
    requestCancel(this.#host(), z.number().int().positive().parse(request.turn));
    await this.#wake();
  }

  // everything the conversation keeps, gone
  async purge(): Promise<void> {
    await this.lifecycle.start();
    await this.#purge();
  }

  // where the thread stands; open work this instance does not run is woken
  async inspect(): Promise<ThreadInspection> {
    await this.lifecycle.start();
    if (this.#purged) {
      return { driving: false, outbox: 0, status: "idle", turn: null };
    }
    const inspection = inspectThread(this.#host(), this.#driving !== null);
    if ((inspection.turn !== null && !inspection.driving) || inspection.outbox > 0) {
      await this.#wake();
    }
    return inspection;
  }
}
