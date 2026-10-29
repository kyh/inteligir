// A Managed Agents API with no model and no account behind it, for the local Worker
// (`pnpm dev:web`), the e2e scenarios and the Worker's suites: the SDK reaches it through its
// `baseURL` (`./serve.ts`) or as its `fetch`, so the cell runs its one code path against it. It
// keeps vaults, credentials, sessions and their events in memory and answers each call in the
// shapes the API reference records (platform.claude.com/docs/en/managed-agents): sessions start
// idle or, seeded, running; events list by `created_at[gte]`, type and order; the stream is SSE,
// `event: <type>` and its JSON, with `event_start`/`event_delta` previews of the agent's message on
// a connection that asks; a budget pauses the session before the request that would pass it; a
// call whose tool is `always_ask` idles on `requires_action` until a `user.tool_confirmation`; an
// interrupt ends a running turn with `end_turn`, and is ignored at a budget pause. Its agent is a
// script (`./fake-script.ts`) that really calls the session's connector with the vault's token
// (`./fake-connector.ts`), so a turn's writes land in the library.

import type {
  BetaManagedAgentsAgentMCPToolResultEvent,
  BetaManagedAgentsAgentMCPToolUseEvent,
  BetaManagedAgentsAgentMessageEvent,
  BetaManagedAgentsSessionErrorEvent,
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsSessionStatusIdleEvent,
  BetaManagedAgentsStreamSessionEvents,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { z } from "zod";

import { callTool, mcpOAuthSchema, serverKey } from "./fake-connector.ts";
import type { ConnectorFetch, McpOAuth, TextBlock } from "./fake-connector.ts";
import { stepsOf } from "./fake-script.ts";
import type { FakeStep, ToolInput } from "./fake-script.ts";

export interface FakeManagedAgentsOptions {
  // how a session reaches the connector its agent names: the platform's fetch in dev and the
  // e2e, the Worker in process in its suites
  readonly connectorFetch: ConnectorFetch;
  readonly now?: () => number;
}

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
}

type Validation = "invalid" | "unknown" | "valid";
type SessionStatus = "idle" | "rescheduling" | "running" | "terminated";
type StopReason = BetaManagedAgentsSessionStatusIdleEvent["stop_reason"];
type Policy = "always_allow" | "always_ask";

// what one model request costs at list price, and the tokens it reads and writes, unless a step
// says otherwise
const REQUEST_CENTS = 1;
const REQUEST_USAGE = { cached: 800, input: 1200, output: 120 } as const;

// a page of events, as the API answers one by default
const EVENTS_PAGE = 1000;

// ---- requests ----

const textBlockSchema = z.object({ text: z.string(), type: z.literal("text") });

const userMessageSchema = z.object({
  content: z.array(textBlockSchema).min(1),
  type: z.literal("user.message"),
});

const sentEventSchema = z.discriminatedUnion("type", [
  userMessageSchema,
  z.object({ content: z.array(textBlockSchema).min(1), type: z.literal("system.message") }),
  z.object({ type: z.literal("user.interrupt") }),
  z.object({
    deny_message: z.string().nullish(),
    result: z.enum(["allow", "deny"]),
    tool_use_id: z.string().min(1),
    type: z.literal("user.tool_confirmation"),
  }),
]);

type SentEvent = z.infer<typeof sentEventSchema>;

const budgetSchema = z.object({
  max_list_cost: z.object({
    amount: z.string().regex(/^[1-9]\d*$/u),
    currency: z.literal("USD"),
  }),
  type: z.literal("limit"),
});

const toolsetSchema = z.object({
  configs: z
    .array(
      z.object({
        enabled: z.boolean().optional(),
        name: z.string(),
        permission_policy: z.object({ type: z.enum(["always_allow", "always_ask"]) }).optional(),
      }),
    )
    .default([]),
  default_config: z.object({ enabled: z.boolean().optional() }).optional(),
  mcp_server_name: z.string(),
  type: z.literal("mcp_toolset"),
});

// the fake has no agents of its own, so it runs the definition a session overrides its agent with,
// as every session of a deployment but production's does
const agentSchema = z.object({
  id: z.string().min(1),
  mcp_servers: z.array(z.object({ name: z.string(), type: z.literal("url"), url: z.url() })),
  tools: z.array(z.looseObject({ type: z.string() })),
  type: z.literal("agent_with_overrides"),
  version: z.number().int().positive().optional(),
});

const createSessionSchema = z.object({
  agent: agentSchema,
  budget: budgetSchema.optional(),
  environment_id: z.string().min(1),
  initial_events: z.array(userMessageSchema).max(50).optional(),
  metadata: z
    .record(z.string().max(64), z.string().max(512))
    .refine((metadata) => Object.keys(metadata).length <= 16, { error: "holds more than 16 keys" })
    .optional(),
  title: z.string().nullish(),
  vault_ids: z.array(z.string()).optional(),
});

const updateSessionSchema = z.object({
  budget: budgetSchema.nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  title: z.string().nullish(),
});

const vaultBodySchema = z.object({
  display_name: z.string().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
});

const credentialBodySchema = z.object({
  auth: mcpOAuthSchema,
  display_name: z.string().optional(),
});

const credentialUpdateSchema = z.object({
  auth: z.object({
    access_token: z.string().min(1).optional(),
    expires_at: z.string().optional(),
    refresh: z.object({ refresh_token: z.string().min(1) }).optional(),
    type: z.literal("mcp_oauth"),
  }),
});

// ---- the session ----

type Decision =
  | { readonly result: "allow" }
  | { readonly result: "deny"; readonly message: string };

type Waiting =
  | { readonly kind: "none" }
  | { readonly kind: "approval"; readonly pending: Map<string, Decision | null> }
  | { readonly kind: "budget" };

interface StreamSink {
  readonly deltas: boolean;
  readonly push: (event: BetaManagedAgentsStreamSessionEvents) => void;
  readonly close: () => void;
}

interface FakeSession {
  readonly id: string;
  readonly createdAt: string;
  readonly agentId: string;
  readonly agentVersion: number;
  readonly environmentId: string;
  metadata: Record<string, string>;
  title: string | null;
  readonly vaultIds: readonly string[];
  // each server by name, and each tool's policy by its name; a tool not named is off
  readonly servers: ReadonlyMap<string, string>;
  readonly tools: ReadonlyMap<string, { readonly server: string; readonly policy: Policy }>;
  status: SessionStatus;
  budgetCents: number | null;
  costCents: number;
  readonly usage: { input: number; output: number; cached: number; activeSeconds: number };
  readonly events: BetaManagedAgentsSessionEvent[];
  readonly systemMessages: string[];
  readonly streams: Set<StreamSink>;
  // the messages it has yet to answer, each as it was sent
  readonly inbox: UserMessage[];
  waiting: Waiting;
  interrupted: boolean;
  deleted: boolean;
  // what the runner waits on, settled by the next event that moves it
  wake: () => void;
  // whether the runner is at work rather than waiting on something from outside
  busy: boolean;
  running: Promise<void> | null;
}

// a request's body, read as JSON before any route parses it
const jsonSchema = z.json();
type Json = z.infer<typeof jsonSchema>;

const bodyOf = (text: string): Json => (text === "" ? null : jsonSchema.parse(JSON.parse(text)));

type UserMessage = z.infer<typeof userMessageSchema>;

// a message's directives are read from all of its text
const textOf = (message: UserMessage): string =>
  message.content.map((block) => block.text).join("\n");

const errorAnswer = (status: number, type: string, message: string): Response =>
  Response.json({ error: { message, type }, request_id: "req_fake", type: "error" }, { status });

const invalid = (message: string): Response => errorAnswer(400, "invalid_request_error", message);

const notFound = (what: string): Response =>
  errorAnswer(404, "not_found_error", `${what} not found`);

const encoder = new TextEncoder();

const sseFrame = (event: BetaManagedAgentsStreamSessionEvents): Uint8Array =>
  encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

// what a session that waits on nothing yet wakes
const nothingToWake = (): void => undefined;

// a wait the runner leaves when something it waits on moves; a promise whose settler the session
// holds, since only the request that moves it can settle it
const nextWake = async (session: FakeSession): Promise<void> => {
  session.busy = false;
  // oxlint-disable-next-line promise/avoid-new -- the request that moves the session settles it from outside the runner, which only a promise's own settler can do
  await new Promise<void>((resolve) => {
    session.wake = () => {
      // one wake a wait: a later one finds nothing waiting, and leaves the runner at rest
      session.wake = nothingToWake;
      session.busy = true;
      resolve();
    };
  });
};

// a moment for the runners at work, which wait on the connector's answers
const tick = async (): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- a timer's callback is the one way to yield to the I/O the runners wait on
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 1);
  });
};

const toolsOf = (
  tools: readonly { readonly type: string }[],
): Map<string, { readonly server: string; readonly policy: Policy }> => {
  const held = new Map<string, { readonly server: string; readonly policy: Policy }>();
  for (const raw of tools) {
    const toolset = toolsetSchema.safeParse(raw);
    if (!toolset.success) {
      continue;
    }
    for (const config of toolset.data.configs) {
      const enabled = config.enabled ?? toolset.data.default_config?.enabled ?? true;
      if (enabled) {
        held.set(config.name, {
          policy: config.permission_policy?.type ?? "always_allow",
          server: toolset.data.mcp_server_name,
        });
      }
    }
  }
  return held;
};

export const fakeManagedAgents = (options: FakeManagedAgentsOptions) => {
  const now = options.now ?? Date.now;
  const calls: RecordedCall[] = [];
  const vaults = new Map<string, Record<string, string>>();
  const credentials = new Map<string, { readonly vaultId: string; auth: McpOAuth }>();
  const sessions = new Map<string, FakeSession>();
  let validation: Validation = "valid";
  let failing: { readonly method: string; readonly path: RegExp } | null = null;
  let minted = 0;

  const mint = (prefix: string): string => {
    minted += 1;
    return `${prefix}_fake${String(minted).padStart(6, "0")}`;
  };

  const iso = (): string => new Date(now()).toISOString();

  // ---- events ----

  // an event the session keeps, sent to every open stream
  const emit = <E extends BetaManagedAgentsSessionEvent>(session: FakeSession, event: E): E => {
    session.events.push(event);
    for (const stream of session.streams) {
      stream.push(event);
    }
    return event;
  };

  // a preview of the agent's message, which only a stream that asked for one hears, never kept
  const preview = (session: FakeSession, id: string, text: string): void => {
    const half = Math.ceil(text.length / 2);
    for (const stream of session.streams) {
      if (!stream.deltas) {
        continue;
      }
      stream.push({ event: { id, type: "agent.message" }, type: "event_start" });
      for (const part of [text.slice(0, half), text.slice(half)]) {
        stream.push({
          delta: { content: { text: part, type: "text" }, index: 0, type: "content_delta" },
          event_id: id,
          type: "event_delta",
        });
      }
    }
  };

  const usageSnapshot = (session: FakeSession) => ({
    active_seconds: session.usage.activeSeconds,
    cache_read_input_tokens: session.usage.cached,
    input_tokens: session.usage.input,
    list_cost: { amount: String(session.costCents), currency: "USD" as const },
    output_tokens: session.usage.output,
  });

  const budgetOf = (session: FakeSession) =>
    session.budgetCents === null
      ? null
      : {
          max_list_cost: { amount: String(session.budgetCents), currency: "USD" as const },
          type: "limit" as const,
        };

  // the usage snapshot that precedes every idle, then the idle
  const idle = (session: FakeSession, stopReason: StopReason): void => {
    emit(session, {
      budget: budgetOf(session),
      id: mint("sevt"),
      processed_at: iso(),
      type: "session.usage",
      usage: usageSnapshot(session),
    });
    session.status = "idle";
    emit(session, {
      id: mint("sevt"),
      processed_at: iso(),
      stop_details: null,
      stop_reason: stopReason,
      type: "session.status_idle",
    });
  };

  const running = (session: FakeSession): void => {
    session.status = "running";
    emit(session, { id: mint("sevt"), processed_at: iso(), type: "session.status_running" });
  };

  // ---- the runner ----

  // before each model request, the budget's gate: a session whose cost reached its cap pauses
  // until the cap is raised past it; false once it is gone
  const pastGate = async (session: FakeSession): Promise<boolean> => {
    while (
      !session.deleted &&
      session.budgetCents !== null &&
      session.costCents >= session.budgetCents
    ) {
      if (session.waiting.kind !== "budget") {
        session.waiting = { kind: "budget" };
        idle(session, { type: "budget_reached" });
      }
      await nextWake(session);
    }
    if (session.waiting.kind === "budget") {
      session.waiting = { kind: "none" };
      running(session);
    }
    return !session.deleted;
  };

  // one model request: its spans, its tokens and its cost
  const modelRequest = (session: FakeSession, cents: number): void => {
    const start = emit(session, {
      id: mint("sevt"),
      processed_at: iso(),
      type: "span.model_request_start",
    });
    session.costCents += cents;
    session.usage.input += REQUEST_USAGE.input;
    session.usage.output += REQUEST_USAGE.output;
    session.usage.cached += REQUEST_USAGE.cached;
    session.usage.activeSeconds += 1;
    emit(session, {
      id: mint("sevt"),
      is_error: false,
      model_request_start_id: start.id,
      model_usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: REQUEST_USAGE.cached,
        input_tokens: REQUEST_USAGE.input,
        output_tokens: REQUEST_USAGE.output,
      },
      processed_at: iso(),
      type: "span.model_request_end",
    });
  };

  const credentialFor = (session: FakeSession, serverUrl: string) => {
    const key = serverKey(serverUrl);
    for (const [id, held] of credentials) {
      if (session.vaultIds.includes(held.vaultId) && serverKey(held.auth.mcp_server_url) === key) {
        return { held, id };
      }
    }
    return null;
  };

  // the person's answer to a paused call, null while the session is gone
  const approval = async (session: FakeSession, id: string): Promise<Decision | null> => {
    const pending = new Map<string, Decision | null>([[id, null]]);
    session.waiting = { kind: "approval", pending };
    idle(session, { event_ids: [id], type: "requires_action" });
    let decision = pending.get(id) ?? null;
    while (decision === null && !session.deleted) {
      await nextWake(session);
      decision = pending.get(id) ?? null;
    }
    session.waiting = { kind: "none" };
    return session.deleted ? null : decision;
  };

  const toolResult = (
    session: FakeSession,
    useId: string,
    content: readonly TextBlock[],
    isError: boolean,
  ): BetaManagedAgentsAgentMCPToolResultEvent =>
    emit(session, {
      content: [...content],
      id: mint("sevt"),
      is_error: isError,
      mcp_tool_use_id: useId,
      processed_at: iso(),
      type: "agent.mcp_tool_result",
    });

  const authFailed = (session: FakeSession, server: string, message: string) =>
    emit(session, {
      error: {
        mcp_server_name: server,
        message,
        retry_status: { type: "retrying" },
        type: "mcp_authentication_failed_error",
      },
      id: mint("sevt"),
      processed_at: iso(),
      type: "session.error",
    } satisfies BetaManagedAgentsSessionErrorEvent);

  // a call of one of the session's tools; false once the session is gone
  const callStep = async (session: FakeSession, tool: string, input: ToolInput) => {
    const held = session.tools.get(tool);
    const server = held?.server ?? "";
    // a tool the session does not enable is refused before any policy applies
    const use: BetaManagedAgentsAgentMCPToolUseEvent = {
      evaluated_permission: "deny",
      id: mint("sevt"),
      input,
      mcp_server_name: server,
      name: tool,
      processed_at: iso(),
      type: "agent.mcp_tool_use",
    };
    if (held !== undefined) {
      use.evaluated_permission = held.policy === "always_ask" ? "ask" : "allow";
      use.evaluation = { type: held.policy };
    }
    emit(session, use);
    if (held === undefined) {
      toolResult(session, use.id, [{ text: `${tool} is not enabled`, type: "text" }], true);
      return true;
    }
    if (held.policy === "always_ask") {
      const decision = await approval(session, use.id);
      if (decision === null) {
        return false;
      }
      running(session);
      if (decision.result === "deny") {
        toolResult(session, use.id, [{ text: decision.message, type: "text" }], true);
        return true;
      }
    }
    const serverUrl = session.servers.get(server) ?? "";
    const credential = credentialFor(session, serverUrl);
    const outcome = await callTool({
      credential: credential?.held.auth ?? null,
      fetch: options.connectorFetch,
      input,
      renew: (renewed) => {
        if (credential !== null) {
          credential.held.auth = renewed;
        }
      },
      serverUrl,
      tool,
    });
    if (outcome.kind === "unauthorized") {
      authFailed(session, server, outcome.message);
      toolResult(session, use.id, [{ text: outcome.message, type: "text" }], true);
      return true;
    }
    toolResult(session, use.id, outcome.content, outcome.isError);
    return !session.deleted;
  };

  // a stall works until an interrupt arrives
  const stallStep = async (session: FakeSession): Promise<void> => {
    while (!session.interrupted && !session.deleted) {
      await nextWake(session);
    }
  };

  const reply = (session: FakeSession, done: readonly FakeStep[]): void => {
    const called = done.flatMap((step) => (step.kind === "call" ? [step.tool] : []));
    const text = called.length === 0 ? "Done." : `Done: ${called.join(", ")}.`;
    const id = mint("sevt");
    preview(session, id, text);
    emit(session, {
      content: [{ text, type: "text" }],
      id,
      processed_at: iso(),
      type: "agent.message",
    } satisfies BetaManagedAgentsAgentMessageEvent);
  };

  // one message's turn: each step a model request past the budget's gate, then the reply
  const runTurn = async (session: FakeSession, message: UserMessage): Promise<void> => {
    emit(session, {
      content: message.content,
      id: mint("sevt"),
      processed_at: iso(),
      type: "user.message",
    });
    running(session);
    const done: FakeStep[] = [];
    for (const step of [...stepsOf(textOf(message)), null]) {
      if (session.interrupted) {
        break;
      }
      if (!(await pastGate(session))) {
        return;
      }
      modelRequest(session, step?.kind === "spend" ? step.cents : REQUEST_CENTS);
      if (step === null) {
        reply(session, done);
        break;
      }
      if (step.kind === "call" && !(await callStep(session, step.tool, step.input))) {
        return;
      }
      if (step.kind === "stall") {
        await stallStep(session);
      }
      done.push(step);
    }
    session.interrupted = false;
    if (!session.deleted) {
      idle(session, { type: "end_turn" });
    }
  };

  // the session's messages, one turn each, in the order they were sent
  const drain = async (session: FakeSession): Promise<void> => {
    for (let next = session.inbox.shift(); next !== undefined; next = session.inbox.shift()) {
      await runTurn(session, next);
      if (session.deleted) {
        return;
      }
    }
  };

  // the session's runner to its end, a failure of the fake's own logged
  const runToEnd = async (session: FakeSession): Promise<void> => {
    session.busy = true;
    try {
      await drain(session);
    } catch (error) {
      console.error({
        event: "managed-agents-fake-turn-failed",
        message: error instanceof Error ? error.message : "the turn failed",
      });
    } finally {
      session.busy = false;
      session.running = null;
    }
  };

  const start = (session: FakeSession): void => {
    session.running ??= runToEnd(session);
  };

  // every session a runner may still work for, a deleted one's included until it lets go
  const live = new Set<FakeSession>();

  // ---- the routes ----

  const sessionRecord = (session: FakeSession) => ({
    agent: { id: session.agentId, type: "agent", version: session.agentVersion },
    archived_at: null,
    budget: budgetOf(session),
    created_at: session.createdAt,
    environment_id: session.environmentId,
    id: session.id,
    metadata: session.metadata,
    outcome_evaluations: [],
    resources: [],
    stats: { active_seconds: session.usage.activeSeconds },
    status: session.status,
    title: session.title,
    type: "session",
    updated_at: iso(),
    usage: usageSnapshot(session),
    vault_ids: session.vaultIds,
  });

  const createSession = (body: Json): Response => {
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      return invalid(z.prettifyError(parsed.error));
    }
    const request = parsed.data;
    const missing = (request.vault_ids ?? []).find((id) => !vaults.has(id));
    if (missing !== undefined) {
      return invalid(`vault ${missing} not found`);
    }
    const session: FakeSession = {
      agentId: request.agent.id,
      agentVersion: request.agent.version ?? 1,
      busy: false,
      budgetCents:
        request.budget === undefined ? null : Number(request.budget.max_list_cost.amount),
      costCents: 0,
      createdAt: iso(),
      deleted: false,
      environmentId: request.environment_id,
      events: [],
      id: mint("sesn"),
      inbox: [...(request.initial_events ?? [])],
      interrupted: false,
      metadata: request.metadata ?? {},
      running: null,
      servers: new Map(request.agent.mcp_servers.map((server) => [server.name, server.url])),
      status: "idle",
      streams: new Set(),
      systemMessages: [],
      title: request.title ?? null,
      tools: toolsOf(request.agent.tools),
      usage: { activeSeconds: 0, cached: 0, input: 0, output: 0 },
      vaultIds: request.vault_ids ?? [],
      waiting: { kind: "none" },
      wake: nothingToWake,
    };
    sessions.set(session.id, session);
    live.add(session);
    if (session.inbox.length > 0) {
      session.status = "running";
      start(session);
    }
    return Response.json(sessionRecord(session));
  };

  const updateSession = (session: FakeSession, body: Json): Response => {
    const parsed = updateSessionSchema.safeParse(body);
    if (!parsed.success) {
      return invalid(z.prettifyError(parsed.error));
    }
    const { budget, metadata, title } = parsed.data;
    if (budget !== undefined) {
      if (session.budgetCents === null && budget !== null) {
        return invalid(
          "budget_create_only: a budget cannot be added to a session created without one",
        );
      }
      const cap = budget === null ? null : Number(budget.max_list_cost.amount);
      if (cap !== null && cap <= session.costCents) {
        return invalid(
          "budget_not_raised: budget.max_list_cost must be greater than the session's consumed list cost",
        );
      }
      session.budgetCents = cap;
      session.wake();
    }
    if (metadata !== undefined) {
      session.metadata = { ...session.metadata, ...metadata };
    }
    if (title !== undefined) {
      session.title = title ?? null;
    }
    return Response.json(sessionRecord(session));
  };

  const deleteSession = (session: FakeSession): Response => {
    if (session.status === "running" || session.status === "rescheduling") {
      return invalid("cannot delete a session while it is running");
    }
    session.deleted = true;
    sessions.delete(session.id);
    for (const stream of session.streams) {
      stream.push({ id: mint("sevt"), processed_at: iso(), type: "session.deleted" });
      stream.close();
    }
    session.wake();
    return Response.json({ id: session.id, type: "session_deleted" });
  };

  // why the API would refuse these events, or null: anything that starts work while the session
  // waits on a settle event, a system message on its own, a confirmation nothing asked for
  const refusalOf = (session: FakeSession, sent: readonly SentEvent[]): string | null => {
    if (session.status === "terminated") {
      return "the session is terminated";
    }
    for (const [index, event] of sent.entries()) {
      if (event.type === "user.message" && session.waiting.kind !== "none") {
        return "only settle events (user.tool_confirmation, user.tool_result, user.custom_tool_result, user.interrupt) are accepted while the session waits";
      }
      if (event.type === "system.message" && sent[index - 1]?.type !== "user.message") {
        return "a system.message must immediately follow the event it accompanies";
      }
      if (
        event.type === "user.tool_confirmation" &&
        (session.waiting.kind !== "approval" || !session.waiting.pending.has(event.tool_use_id))
      ) {
        return `${event.tool_use_id} is not waiting on a confirmation`;
      }
    }
    return null;
  };

  // a settle event answers what the session waits on; a message joins its inbox
  const sendEvents = (session: FakeSession, body: Json): Response => {
    const parsed = z.object({ events: z.array(sentEventSchema).min(1) }).safeParse(body);
    if (!parsed.success) {
      return invalid(z.prettifyError(parsed.error));
    }
    const sent: SentEvent[] = parsed.data.events;
    const refused = refusalOf(session, sent);
    if (refused !== null) {
      return invalid(refused);
    }
    const echoed: BetaManagedAgentsSessionEvent[] = [];
    for (const event of sent) {
      switch (event.type) {
        case "user.message": {
          session.inbox.push(event);
          break;
        }
        case "system.message": {
          const text = event.content.map((block) => block.text).join("\n");
          session.systemMessages.push(text);
          echoed.push(
            emit(session, {
              content: event.content,
              id: mint("sevt"),
              processed_at: iso(),
              type: "system.message",
            }),
          );
          break;
        }
        case "user.interrupt": {
          // accepted and ignored at a budget pause, and a no-op on an idle session
          if (session.waiting.kind === "none" && session.status === "running") {
            session.interrupted = true;
            echoed.push(
              emit(session, { id: mint("sevt"), processed_at: iso(), type: "user.interrupt" }),
            );
          }
          break;
        }
        case "user.tool_confirmation": {
          if (session.waiting.kind === "approval") {
            session.waiting.pending.set(
              event.tool_use_id,
              event.result === "allow"
                ? { result: "allow" }
                : { message: event.deny_message ?? "The person declined this.", result: "deny" },
            );
          }
          echoed.push(
            emit(session, {
              deny_message: event.deny_message ?? null,
              id: mint("sevt"),
              processed_at: iso(),
              result: event.result,
              tool_use_id: event.tool_use_id,
              type: "user.tool_confirmation",
            }),
          );
          break;
        }
        // no default
      }
    }
    session.wake();
    if (session.inbox.length > 0) {
      start(session);
    }
    return Response.json({ data: echoed });
  };

  const listEvents = (session: FakeSession, query: URLSearchParams): Response => {
    const since = query.get("created_at[gte]");
    const types = query.getAll("types[]");
    const limit = Math.min(Number(query.get("limit") ?? EVENTS_PAGE), EVENTS_PAGE);
    const from = Number(query.get("page") ?? "0");
    const matched = session.events.filter(
      (event) =>
        (since === null || (event.processed_at ?? "") >= since) &&
        (types.length === 0 || types.includes(event.type)),
    );
    const ordered = query.get("order") === "desc" ? matched.toReversed() : matched;
    const page = ordered.slice(from, from + limit);
    const next = from + page.length;
    return Response.json({ data: page, next_page: next < ordered.length ? String(next) : null });
  };

  const streamEvents = (session: FakeSession, query: URLSearchParams): Response => {
    const deltas = query.getAll("event_deltas[]").includes("agent.message");
    let sink: StreamSink | null = null;
    const body = new ReadableStream<Uint8Array>({
      cancel: () => {
        if (sink !== null) {
          session.streams.delete(sink);
        }
      },
      start: (controller) => {
        const own: StreamSink = {
          close: () => {
            session.streams.delete(own);
            controller.close();
          },
          deltas,
          push: (event) => {
            try {
              controller.enqueue(sseFrame(event));
            } catch {
              // the reader went between the event and its frame; its cancel lets the session go
              session.streams.delete(own);
            }
          },
        };
        sink = own;
        session.streams.add(own);
      },
    });
    return new Response(body, {
      headers: { "cache-control": "no-cache", "content-type": "text/event-stream" },
    });
  };

  const listSessions = (query: URLSearchParams): Response => {
    const since = query.get("created_at[gte]");
    const data = [...sessions.values()]
      .filter((session) => since === null || session.createdAt >= since)
      .toReversed()
      .map(sessionRecord);
    return Response.json({ data, next_page: null, prev_page: null });
  };

  const createVault = (body: Json): Response => {
    const { display_name, metadata } = vaultBodySchema.parse(body);
    const id = mint("vlt");
    vaults.set(id, metadata);
    return Response.json({
      archived_at: null,
      created_at: iso(),
      display_name: display_name ?? "",
      id,
      metadata,
      type: "vault",
      updated_at: iso(),
    });
  };

  const credentialRecord = (id: string, held: { readonly vaultId: string; auth: McpOAuth }) => ({
    archived_at: null,
    auth: { mcp_server_url: held.auth.mcp_server_url, type: "mcp_oauth" },
    created_at: iso(),
    display_name: "Inteligir library",
    id,
    metadata: {},
    type: "vault_credential",
    updated_at: iso(),
    vault_id: held.vaultId,
  });

  const vaultAt = (vaultId: string, answer: () => Response): Response =>
    vaults.has(vaultId) ? answer() : notFound("vault");

  const credentialAt = (
    vaultId: string,
    id: string,
    answer: (held: { readonly vaultId: string; auth: McpOAuth }) => Response,
  ): Response => {
    const held = credentials.get(id);
    return held?.vaultId === vaultId ? answer(held) : notFound("credential");
  };

  const sessionAt = (id: string, answer: (session: FakeSession) => Response): Response => {
    const session = sessions.get(id);
    return session === undefined ? notFound("session") : answer(session);
  };

  interface Route {
    readonly method: string;
    readonly path: RegExp;
    readonly answer: (
      ids: Readonly<Record<string, string>>,
      body: Json,
      query: URLSearchParams,
    ) => Response;
  }

  const routes: readonly Route[] = [
    { answer: (_, body) => createVault(body), method: "POST", path: /^\/v1\/vaults$/u },
    {
      answer: ({ vault = "" }) =>
        vaultAt(vault, () =>
          Response.json({
            display_name: "",
            id: vault,
            metadata: vaults.get(vault),
            type: "vault",
          }),
        ),
      method: "GET",
      path: /^\/v1\/vaults\/(?<vault>[^/]+)$/u,
    },
    {
      answer: ({ vault = "" }) =>
        vaultAt(vault, () => {
          vaults.delete(vault);
          for (const [id, held] of credentials) {
            if (held.vaultId === vault) {
              credentials.delete(id);
            }
          }
          return Response.json({ id: vault, type: "vault_deleted" });
        }),
      method: "DELETE",
      path: /^\/v1\/vaults\/(?<vault>[^/]+)$/u,
    },
    {
      answer: ({ vault = "" }, body) =>
        vaultAt(vault, () => {
          const parsed = credentialBodySchema.safeParse(body);
          if (!parsed.success) {
            return invalid(z.prettifyError(parsed.error));
          }
          const id = mint("vcrd");
          const held = { auth: parsed.data.auth, vaultId: vault };
          credentials.set(id, held);
          return Response.json(credentialRecord(id, held));
        }),
      method: "POST",
      path: /^\/v1\/vaults\/(?<vault>[^/]+)\/credentials$/u,
    },
    {
      answer: ({ credential = "", vault = "" }) =>
        credentialAt(vault, credential, () =>
          Response.json({
            credential_id: credential,
            has_refresh_token: true,
            mcp_probe: null,
            refresh: null,
            status: validation,
            type: "vault_credential_validation",
            validated_at: iso(),
            vault_id: vault,
          }),
        ),
      method: "POST",
      path: /^\/v1\/vaults\/(?<vault>[^/]+)\/credentials\/(?<credential>[^/]+)\/mcp_oauth_validate$/u,
    },
    {
      answer: ({ credential = "", vault = "" }, body) =>
        credentialAt(vault, credential, (held) => {
          const { auth } = credentialUpdateSchema.parse(body);
          // a field the update leaves out keeps its value, the refresh block's included
          held.auth = {
            ...held.auth,
            access_token: auth.access_token ?? held.auth.access_token,
            expires_at: auth.expires_at ?? held.auth.expires_at,
            refresh:
              held.auth.refresh === undefined
                ? undefined
                : { ...held.auth.refresh, ...auth.refresh },
          };
          return Response.json(credentialRecord(credential, held));
        }),
      method: "POST",
      path: /^\/v1\/vaults\/(?<vault>[^/]+)\/credentials\/(?<credential>[^/]+)$/u,
    },
    { answer: (_, body) => createSession(body), method: "POST", path: /^\/v1\/sessions$/u },
    {
      answer: (_ids, _body, query) => listSessions(query),
      method: "GET",
      path: /^\/v1\/sessions$/u,
    },
    {
      answer: ({ session = "" }) =>
        sessionAt(session, (held) => Response.json(sessionRecord(held))),
      method: "GET",
      path: /^\/v1\/sessions\/(?<session>[^/]+)$/u,
    },
    {
      answer: ({ session = "" }, body) => sessionAt(session, (held) => updateSession(held, body)),
      method: "POST",
      path: /^\/v1\/sessions\/(?<session>[^/]+)$/u,
    },
    {
      answer: ({ session = "" }) => sessionAt(session, deleteSession),
      method: "DELETE",
      path: /^\/v1\/sessions\/(?<session>[^/]+)$/u,
    },
    {
      answer: ({ session = "" }, _body, query) =>
        sessionAt(session, (held) => listEvents(held, query)),
      method: "GET",
      path: /^\/v1\/sessions\/(?<session>[^/]+)\/events$/u,
    },
    {
      answer: ({ session = "" }, body) => sessionAt(session, (held) => sendEvents(held, body)),
      method: "POST",
      path: /^\/v1\/sessions\/(?<session>[^/]+)\/events$/u,
    },
    {
      answer: ({ session = "" }, _body, query) =>
        sessionAt(session, (held) => streamEvents(held, query)),
      method: "GET",
      path: /^\/v1\/sessions\/(?<session>[^/]+)\/events\/stream$/u,
    },
  ];

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    calls.push({
      body: text,
      headers: request.headers,
      method: request.method,
      path: url.pathname,
    });
    if (failing?.method === request.method && failing.path.test(url.pathname)) {
      failing = null;
      // marked as one no retry mends, so the SDK hands it straight back
      const failed = errorAnswer(500, "api_error", "Internal server error");
      failed.headers.set("x-should-retry", "false");
      return failed;
    }
    for (const route of routes) {
      const matched = route.method === request.method ? route.path.exec(url.pathname) : null;
      if (matched !== null) {
        return route.answer(matched.groups ?? {}, bodyOf(text), url.searchParams);
      }
    }
    return notFound(`${request.method} ${url.pathname}`);
  };

  return {
    calls,
    credentials,
    // the next call that matches answers as the API does when it fails
    failNext: (method: string, path: RegExp): void => {
      failing = { method, path };
    },
    fetch,
    // a session the account holds, outside any turn the fake runs
    holdSession: (status: SessionStatus): string => {
      const id = mint("sesn");
      sessions.set(id, {
        agentId: "agent_fake",
        agentVersion: 1,
        budgetCents: null,
        busy: false,
        costCents: 0,
        createdAt: iso(),
        deleted: false,
        environmentId: "env_fake",
        events: [],
        id,
        inbox: [],
        interrupted: false,
        metadata: {},
        running: null,
        servers: new Map(),
        status,
        streams: new Set(),
        systemMessages: [],
        title: null,
        tools: new Map(),
        usage: { activeSeconds: 0, cached: 0, input: 0, output: 0 },
        vaultIds: [],
        waiting: { kind: "none" },
        wake: () => {
          const held = sessions.get(id);
          if (held?.status === "running") {
            held.status = "idle";
          }
        },
      });
      return id;
    },
    sessions,
    // every turn the fake is running at rest: finished, or waiting on an approval, a budget or an
    // interrupt
    settled: async (): Promise<void> => {
      while ([...live].some((session) => session.busy)) {
        await tick();
      }
    },
    validateAs: (status: Validation): void => {
      validation = status;
    },
    vaults,
  };
};

export type FakeManagedAgents = ReturnType<typeof fakeManagedAgents>;
