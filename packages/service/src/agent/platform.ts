// The only module that calls eve: no client shape reaches a row, and the suites swap in
// `../test-support/fake-agent-platform`. The agent is a service of its own beside the app
// (apps/web/agent, served under /eve/v1), so every call is HTTP, signed with a token minted for that
// call alone (`./eve-token`).

import type { agentViewContextSchema } from "@repo/contract/library/library-wire";
import { Client, ClientError, SessionNotActiveError } from "eve/client";
import { z } from "zod";

import { APP_URL } from "../app-url";
import type { EveTokenSubject } from "./eve-token";
import { eveOperationId, mintEveToken } from "./eve-token";

// whom a call acts for, and in which session of which thread: what its token carries
export type AgentCaller = Omit<EveTokenSubject, "eveSessionId">;

// what the person is looking at: the model reads it this turn only, and eve keeps none of it
type ClientContext = z.infer<typeof agentViewContextSchema>;

export interface AgentMessage {
  readonly text: string;
  readonly clientContext?: ClientContext | undefined;
  // a resend under one key is delivered once
  readonly idempotencyKey?: string | undefined;
}

type AgentPlatformFailure =
  // the eve session takes nothing more: ended, expired, or stranded on another eve version
  | "ended"
  // our own channel refused the call: the thread was deleted
  | "refused"
  | "rejected"
  | "unavailable";

export class AgentPlatformError extends Error {
  readonly failure: AgentPlatformFailure;

  constructor(failure: AgentPlatformFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentPlatformError";
    this.failure = failure;
  }
}

export const isSessionEnded = (cause: unknown): boolean =>
  cause instanceof AgentPlatformError && cause.failure === "ended";

// a new eve session, and the delivery its first message is
export interface AgentSessionCreated {
  readonly deliveryId: string;
  readonly sessionId: string;
}

export interface AgentPlatform {
  // Creates the caller's numbered eve session and starts its first turn: a retry answers the same
  // session and delivery, never a second one
  readonly createSession: (
    caller: AgentCaller,
    message: AgentMessage,
  ) => Promise<AgentSessionCreated>;
  // steers a running turn, or starts the next; answers the message's delivery id
  readonly send: (caller: AgentCaller, sessionId: string, message: AgentMessage) => Promise<string>;
  // stops the running turn; an idle session ignores it
  readonly cancel: (caller: AgentCaller, sessionId: string) => Promise<void>;
  // retires the eve session for good: "gone" when it already was
  readonly end: (caller: AgentCaller, sessionId: string) => Promise<"ended" | "gone">;
}

const SESSION_ENDED_CODES = new Set(["session_expired", "session_not_active", "session_stranded"]);

const failureOf = (error: ClientError): AgentPlatformError => {
  if (SESSION_ENDED_CODES.has(error.code) || error.status === 404 || error.status === 410) {
    return new AgentPlatformError("ended", error.message, { cause: error });
  }
  switch (error.status) {
    case 400:
    case 413:
    case 422: {
      return new AgentPlatformError("rejected", error.message, { cause: error });
    }
    case 401:
    case 403: {
      return new AgentPlatformError("refused", error.message, { cause: error });
    }
    default: {
      return new AgentPlatformError("unavailable", error.message, { cause: error });
    }
  }
};

const platformError = (cause: unknown): Error => {
  if (ClientError.is(cause)) {
    return failureOf(cause);
  }
  // a retryable one is a session still settling which owner takes its address: it hasn't ended
  if (SessionNotActiveError.is(cause)) {
    return new AgentPlatformError(cause.retryable ? "unavailable" : "ended", cause.message, {
      cause,
    });
  }
  if (cause instanceof TypeError) {
    return new AgentPlatformError("unavailable", cause.message, { cause });
  }
  return cause instanceof Error ? cause : new Error("eve's call failed.", { cause });
};

const calling = async <T>(request: () => Promise<T>): Promise<T> => {
  try {
    return await request();
  } catch (error) {
    throw platformError(error);
  }
};

// a preview behind Vercel's deployment protection lets the app reach its own agent only so
const bypassHeaders = (): Record<string, string> => {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret === undefined ? {} : { "x-vercel-protection-bypass": secret };
};

const clientFor = (caller: AgentCaller, eveSessionId: string | null): Client =>
  new Client({
    auth: { bearer: async () => await mintEveToken({ ...caller, eveSessionId }) },
    baseUrl: APP_URL,
    headers: bypassHeaders(),
  });

const createdSchema = z.object({ deliveryId: z.string().min(1), sessionId: z.string().min(1) });
const deliveredSchema = z.object({ deliveryId: z.string().min(1) });

// a message as eve's routes take it: a create names its operation, a follow-up its delivery's key
interface MessageBody {
  message: string;
  clientContext?: ClientContext;
  idempotencyKey?: string;
  operationId?: string;
}

const bodyOf = ({ clientContext, text }: AgentMessage): MessageBody => {
  const body: MessageBody = { message: text };
  if (clientContext !== undefined) {
    body.clientContext = clientContext;
  }
  return body;
};

// eve's client takes neither a create's operationId nor a message's idempotencyKey, so both go
// through its raw fetch
const postMessage = async <T>(
  client: Client,
  path: string,
  body: MessageBody,
  answer: z.ZodType<T>,
): Promise<T> => {
  const response = await client.fetch(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new ClientError(response.status, text, response.headers);
  }
  return answer.parse(JSON.parse(text));
};

export const deploymentAgentPlatform = (): AgentPlatform => ({
  cancel: async (caller, sessionId) => {
    await calling(async () => {
      await clientFor(caller, sessionId).sessions.attach(sessionId).cancel();
    });
  },

  createSession: async (caller, message) =>
    await calling(
      async () =>
        await postMessage(
          clientFor(caller, null),
          "/eve/v1/session",
          {
            ...bodyOf(message),
            operationId: eveOperationId(caller.threadId, caller.eveSessionNumber),
          },
          createdSchema,
        ),
    ),

  end: async (caller, sessionId) => {
    try {
      await clientFor(caller, sessionId).sessions.attach(sessionId).end();
      return "ended";
    } catch (error) {
      const failure = platformError(error);
      if (isSessionEnded(failure)) {
        return "gone";
      }
      throw failure;
    }
  },

  send: async (caller, sessionId, message) =>
    await calling(async () => {
      const body = bodyOf(message);
      if (message.idempotencyKey !== undefined) {
        body.idempotencyKey = message.idempotencyKey;
      }
      const { deliveryId } = await postMessage(
        clientFor(caller, sessionId),
        `/eve/v1/session/${encodeURIComponent(sessionId)}`,
        body,
        deliveredSchema,
      );
      return deliveryId;
    }),
});
