// One conversation with the built-in agent: a SQLite Durable Object of its own, named
// `agent-thread:<accountId>:<threadId>` by its account's cell (`./thread-stub`), which alone
// reaches it, and reaching that cell alone back, by the account its own name holds. Its loop
// (`./thread-loop`) runs on the Agents SDK's Lifecycle, its durable job queue and its one alarm,
// and on nothing else of the SDK, under one job, `drive`: it starts the work detached from the
// alarm's dispatch unless this instance runs it already, and stays, re-timed every 30 seconds, as
// the watchdog that brings a dead instance's work back and cuts a reply gone silent in a live one;
// once the work rests it waits at what the thread's rows wait on (`nextWake`), an approval's
// deadline or a push the cell could not take, and goes when they wait on nothing. Where the work
// stands is one value, moved by `./thread-drive`, and a purged conversation runs nothing more. The
// job is pushed to run once, its outcome returned rather than thrown, since Lifecycle retries a
// job three times in process by default. A fresh instance holds no work, so the `drive` job it
// finds is woken at once: its step sends again whole the call a dead instance left, or rests again
// where the rows say. Each RPC starts the lifecycle, as native RPC needs, and is safe to repeat. A
// cell that answers that it holds no such thread has the object purge itself. Its schema is
// applied in the constructor, before Lifecycle's first job makes its own table.

import type Anthropic from "@anthropic-ai/sdk";
import { Lifecycle } from "agents/lifecycle";
import type { LifecycleJobOutcome } from "agents/lifecycle";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import { libraryCell } from "../library/library-cell";
import { errorFields } from "../log";
import { openWithSchema } from "../object-schema";
import { anthropicClient } from "./anthropic-client";
import { THREAD_SCHEMA, threadDbOf } from "./thread-db";
import { cutCall, nextDrive, RESTING } from "./thread-drive";
import type { Drive, DriveEffect, DriveEvent } from "./thread-drive";
import {
  acceptDelivery,
  cutSilentCalls,
  decideCall,
  inspectThread,
  listeningFetch,
  nextWake,
  requestCancel,
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

// the job runs once a dispatch: the loop answers its own failures
const ONCE = { maxAttempts: 1 } as const;

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

  readonly #calls = new Map<number, CallInFlight>();
  #drive: Drive = RESTING;
  // undefined until a call first asks for it; null where the deployment names no gateway
  #client: Anthropic | null | undefined;
  readonly #db = threadDbOf(this.ctx.storage);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    openWithSchema(ctx, THREAD_SCHEMA);
  }

  #host(): ThreadHost {
    const { accountId, threadId } = threadNameOf(this.ctx.id.name);
    return {
      calls: this.#calls,
      cell: () => libraryCell(this.ctx.exports, accountId),
      db: this.#db,
      client: () => {
        if (this.#client === undefined) {
          this.#client = anthropicClient(
            this.env,
            accountId,
            listeningFetch(this.#calls, Date.now),
          );
        }
        return this.#client;
      },
      definition: deployedDefinition,
      driveAt: async (at) => {
        await this.#driveAt(at);
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
    await this.lifecycle.jobs.reschedule(DRIVE_JOB, Date.now());
  }

  // the drive job come due: the work started, unless this instance runs it already, where a reply
  // gone silent is cut for the loop to send again; the job stays as the watchdog
  onJob(): LifecycleJobOutcome {
    switch (this.#move({ kind: "kick" })) {
      case "start": {
        this.lifecycle.trackAlarmWork(this.#stepFrom(this.#host()));
        break;
      }
      case "watch": {
        cutSilentCalls(this.#calls, Date.now());
        break;
      }
      default: {
        return undefined;
      }
    }
    return { rescheduleAt: Date.now() + WATCHDOG_MS };
  }

  // ---- the loop ----

  #move(event: DriveEvent): DriveEffect {
    const next = nextDrive(this.#drive, event);
    this.#drive = next.drive;
    return next.effect;
  }

  async #driveAt(at: number): Promise<void> {
    await this.lifecycle.jobs.push({ fn: DRIVE_JOB, id: DRIVE_JOB, retry: ONCE, time: at });
  }

  // the loop stepped while the drive says so. Resting, the job waits at the thread's next wake, or
  // goes where its rows wait on nothing, written in the block that moved the drive, so nothing
  // new lands between the two; after a step that threw, it is timed for a retry
  async #stepFrom(host: ThreadHost): Promise<void> {
    let effect: DriveEffect = "step";
    while (effect === "step") {
      try {
        effect = this.#move({ kind: "stepped", result: await step(host) });
      } catch (error) {
        effect = this.#move({ kind: "threw" });
        if (effect === "retry") {
          console.error({ event: "agent-thread-step-failed", ...errorFields(error) });
        }
      }
    }
    if (effect === "retry") {
      await this.#driveAt(Date.now() + AGAIN_MS);
    } else if (effect === "rest") {
      const at = nextWake(this.#db, Date.now());
      await (at === null ? this.lifecycle.jobs.cancel(DRIVE_JOB) : this.#driveAt(at));
    }
  }

  // durable intent first: the drive job is the record that this thread has work
  async #wake(): Promise<void> {
    if (this.#move({ kind: "wake" }) === "push") {
      await this.#driveAt(Date.now());
    }
  }

  async #purge(): Promise<void> {
    if (this.#move({ kind: "purge" }) !== "purge") {
      return;
    }
    for (const call of this.#calls.values()) {
      cutCall(call.abort, "purged");
    }
    await this.lifecycle.disableAlarms();
    await this.ctx.storage.deleteAll();
  }

  // ---- what the cell asks ----

  // a turn handed in: kept once by its number, and the work woken
  async send(request: DeliveryRequest): Promise<void> {
    await this.lifecycle.start();
    const delivery = deliveryRequestSchema.parse(request);
    if (
      this.#drive.kind === "purged" ||
      delivery.threadId !== threadNameOf(this.ctx.id.name).threadId
    ) {
      return;
    }
    acceptDelivery(this.#host(), delivery);
    await this.#wake();
  }

  // the person's answer to a call waiting on them, decided once
  async respond(request: RespondRequest): Promise<void> {
    await this.lifecycle.start();
    if (this.#drive.kind === "purged") {
      return;
    }
    // decided and woken in one block: an answer kept with no job to run it would wait out its
    // deadline
    if (decideCall(this.#host(), respondRequestSchema.parse(request))) {
      await this.#wake();
    }
  }

  // the turn stopped: marked durably, its stream cut, its calls answered by the next step
  async cancel(request: { readonly turn: number }): Promise<void> {
    await this.lifecycle.start();
    if (this.#drive.kind === "purged") {
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
    if (this.#drive.kind === "purged") {
      return { driving: false, outbox: 0, turn: null };
    }
    const inspection = inspectThread(this.#host(), this.#drive.kind === "driving");
    if ((inspection.turn !== null && !inspection.driving) || inspection.outbox > 0) {
      await this.#wake();
    }
    return inspection;
  }
}
