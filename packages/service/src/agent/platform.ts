import type { agentViewContextSchema } from "@repo/contract/library/library-wire";
import { Client, ClientError, SessionNotActiveError } from "eve/client";
import type { ReconnectOptions, SessionStreamEvent } from "eve/client";
import { z } from "zod";

import { APP_URL } from "../app-url";
import { env } from "../env";
import type { EveTokenSubject } from "./eve-token";
import { eveOperationId, mintEveToken } from "./eve-token";

export type AgentCaller = Omit<EveTokenSubject, "eveSessionId">;

type ClientContext = z.infer<typeof agentViewContextSchema>;

export interface AgentMessage {
  readonly text: string;
  readonly clientContext?: ClientContext | undefined;
  readonly idempotencyKey?: string | undefined;
}

type AgentPlatformFailure = "ended" | "refused" | "rejected" | "unavailable";

export class AgentPlatformError extends Error {
  readonly failure: AgentPlatformFailure;

  constructor(failure: AgentPlatformFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentPlatformError";
    this.failure = failure;
  }
}

export const isSessionEnded = (cause: unknown) =>
  cause instanceof AgentPlatformError && cause.failure === "ended";

export interface AgentSessionCreated {
  readonly deliveryId: string;
  readonly sessionId: string;
}

export type AgentStreamEvent = SessionStreamEvent;

interface AgentStreamOptions {
  readonly startIndex: number;
  readonly signal: AbortSignal;
}

export interface AgentPlatform {
  readonly createSession: (
    caller: AgentCaller,
    message: AgentMessage,
  ) => Promise<AgentSessionCreated>;
  readonly send: (caller: AgentCaller, sessionId: string, message: AgentMessage) => Promise<string>;
  readonly cancel: (caller: AgentCaller, sessionId: string) => Promise<void>;
  readonly end: (caller: AgentCaller, sessionId: string) => Promise<"ended" | "gone">;
  readonly stream: (
    caller: AgentCaller,
    sessionId: string,
    options: AgentStreamOptions,
  ) => AsyncIterable<AgentStreamEvent>;
}

const SESSION_ENDED_CODES = new Set(["session_expired", "session_not_active", "session_stranded"]);

const failureOf = (error: ClientError) => {
  if (SESSION_ENDED_CODES.has(error.code) || error.status === 404 || error.status === 410) {
    return new AgentPlatformError("ended", error.message, {
      cause: error,
    }) satisfies AgentPlatformError;
  }

  switch (error.status) {
    case 400:
    case 413:
    case 422: {
      return new AgentPlatformError("rejected", error.message, {
        cause: error,
      }) satisfies AgentPlatformError;
    }

    case 401:
    case 403: {
      return new AgentPlatformError("refused", error.message, {
        cause: error,
      }) satisfies AgentPlatformError;
    }

    default: {
      return new AgentPlatformError("unavailable", error.message, {
        cause: error,
      }) satisfies AgentPlatformError;
    }
  }
};

const platformError = (cause: unknown) => {
  if (ClientError.is(cause)) {
    return failureOf(cause);
  }

  if (SessionNotActiveError.is(cause)) {
    return new AgentPlatformError(cause.retryable ? "unavailable" : "ended", cause.message, {
      cause,
    }) satisfies Error;
  }

  if (cause instanceof TypeError) {
    return new AgentPlatformError("unavailable", cause.message, { cause }) satisfies Error;
  }

  return (
    cause instanceof Error ? cause : new Error("eve's call failed.", { cause })
  ) satisfies Error;
};

const calling = async <T>(request: () => Promise<T>) => {
  try {
    return await request();
  } catch (error) {
    throw platformError(error);
  }
};

const bypassHeaders = () => {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  const headers: Record<string, string> =
    secret === undefined ? {} : { "x-vercel-protection-bypass": secret };

  return headers;
};

const agentBaseUrl = () =>
  env.EVE_BASE_URL !== undefined && process.env.VERCEL !== "1" ? env.EVE_BASE_URL : APP_URL;

const clientFor = (caller: AgentCaller, eveSessionId: string | null) =>
  new Client({
    auth: { bearer: async () => await mintEveToken({ ...caller, eveSessionId }) },
    baseUrl: agentBaseUrl(),
    headers: bypassHeaders(),
  }) satisfies Client;

const STREAM_RECONNECT: ReconnectOptions = { retryableStatuses: [425, 500, 502, 503, 504] };

const createdSchema = z.object({ deliveryId: z.string().min(1), sessionId: z.string().min(1) });
const deliveredSchema = z.object({ deliveryId: z.string().min(1) });

interface MessageBody {
  message: string;
  clientContext?: ClientContext;
  idempotencyKey?: string;
  operationId?: string;
}

const bodyOf = ({ clientContext, text }: AgentMessage) => {
  const body: MessageBody = { message: text };

  if (clientContext !== undefined) {
    body.clientContext = clientContext;
  }

  return body;
};

const postMessage = async <T>(
  client: Client,
  path: string,
  body: MessageBody,
  answer: z.ZodType<T>,
) => {
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

export const deploymentAgentPlatform = () =>
  ({
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

    stream: (caller, sessionId, { signal, startIndex }) => ({
      [Symbol.asyncIterator]: async function* events() {
        const session = clientFor(caller, sessionId).sessions.attach(sessionId);

        try {
          yield* session.stream({ reconnect: STREAM_RECONNECT, signal, startIndex });
        } catch (error) {
          throw platformError(error);
        }
      },
    }),
  }) satisfies AgentPlatform;
