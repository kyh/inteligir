// The calls a turn makes of Managed Agents. A read is asked again freely. A create or a send is
// sent once, since one the SDK retried after a lost answer would make a
// second session or say the person's message twice; one that failed in a way that may still have
// reached Anthropic (a timeout, a dropped connection, a server's own failure) is looked for before
// the cell decides it did not land, and only a plain refusal is taken at its word
// (platform.claude.com/docs/en/api/errors). Every failure logs what Anthropic's support reads.

import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  BetaManagedAgentsEventParams,
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsSessionEventType,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";

import { callFailureFields, SEND_ONCE } from "./managed-agents";
import type { ManagedAgents } from "./managed-agents";

// a read, or a call that sets what it sets however often it lands
export const ASK_AGAIN = { maxRetries: 2 } as const;

// what a look for a call's effect allows the clocks to disagree by
const CLOCK_SKEW_MS = 60_000;
// the sessions made since a create that a look reads at most, newest first
const SESSIONS_LOOKED_AT = 200;

// whether a failed call may still have taken effect at Anthropic
const mayHaveLanded = (cause: unknown): boolean =>
  !(cause instanceof APIError) ||
  cause instanceof APIConnectionError ||
  cause.status === undefined ||
  cause.status >= 500;

const sinceIso = (since: number): string => new Date(since - CLOCK_SKEW_MS).toISOString();

export interface SessionOwner {
  readonly accountId: string;
  readonly threadId: string;
}

// a session made for this thread since `since`: the one a create the cell lost the answer to made
export const findMadeSession = async (
  agents: ManagedAgents,
  owner: SessionOwner,
  since: number,
): Promise<string | null> => {
  let looked = 0;
  for await (const session of agents.client.beta.sessions.list(
    { "created_at[gte]": sinceIso(since), limit: 100, order: "desc" },
    ASK_AGAIN,
  )) {
    if (
      session.metadata["accountId"] === owner.accountId &&
      session.metadata["threadId"] === owner.threadId
    ) {
      return session.id;
    }
    looked += 1;
    if (looked >= SESSIONS_LOOKED_AT) {
      break;
    }
  }
  return null;
};

// a new session for the thread, or null when none was made
export const createSessionOnce = async (
  agents: ManagedAgents,
  params: Anthropic.Beta.Sessions.SessionCreateParams,
  look: { readonly owner: SessionOwner; readonly since: number },
): Promise<string | null> => {
  try {
    const made = await agents.client.beta.sessions.create(params, SEND_ONCE);
    return made.id;
  } catch (error) {
    console.warn({ event: "agent-session-create-failed", ...callFailureFields(error) });
    if (!mayHaveLanded(error)) {
      return null;
    }
  }
  try {
    return await findMadeSession(agents, look.owner, look.since);
  } catch (error) {
    console.warn({ event: "agent-session-look-failed", ...callFailureFields(error) });
    return null;
  }
};

// an event of `type` the session holds since `since` that `matches`
export const sessionSaw = async (
  agents: ManagedAgents,
  sessionId: string,
  look: {
    readonly since: number;
    readonly type: BetaManagedAgentsSessionEventType;
    readonly matches: (event: BetaManagedAgentsSessionEvent) => boolean;
  },
): Promise<boolean> => {
  for await (const event of agents.client.beta.sessions.events.list(
    sessionId,
    { "created_at[gte]": sinceIso(look.since), limit: 100, order: "asc", types: [look.type] },
    ASK_AGAIN,
  )) {
    if (look.matches(event)) {
      return true;
    }
  }
  return false;
};

// events sent to the session, true once they landed: a failure that may have landed is looked for
// by its first event, which `look` recognizes
export const sendEventsOnce = async (
  agents: ManagedAgents,
  sessionId: string,
  events: BetaManagedAgentsEventParams[],
  look: Parameters<typeof sessionSaw>[2],
): Promise<boolean> => {
  try {
    await agents.client.beta.sessions.events.send(sessionId, { events }, SEND_ONCE);
    return true;
  } catch (error) {
    console.warn({ event: "agent-events-send-failed", ...callFailureFields(error) });
    if (!mayHaveLanded(error)) {
      return false;
    }
  }
  try {
    return await sessionSaw(agents, sessionId, look);
  } catch (error) {
    console.warn({ event: "agent-events-look-failed", ...callFailureFields(error) });
    return false;
  }
};

// the session interrupted, which a second interrupt leaves as it is
export const interruptSession = async (
  agents: ManagedAgents,
  sessionId: string,
): Promise<boolean> => {
  try {
    await agents.client.beta.sessions.events.send(
      sessionId,
      { events: [{ type: "user.interrupt" }] },
      ASK_AGAIN,
    );
    return true;
  } catch (error) {
    console.warn({ event: "agent-interrupt-failed", ...callFailureFields(error) });
    return false;
  }
};

// the person's answer to each paused call, one confirmation a call, in one send
export const confirmCalls = async (
  agents: ManagedAgents,
  sessionId: string,
  answers: {
    readonly eventIds: readonly string[];
    readonly result: "allow" | "deny";
    readonly denyMessage: string | null;
    readonly since: number;
  },
): Promise<boolean> => {
  const [first] = answers.eventIds;
  if (first === undefined) {
    return true;
  }
  // a denial says why; an allowance carries no message
  const denyMessage = answers.result === "deny" ? answers.denyMessage : null;
  return await sendEventsOnce(
    agents,
    sessionId,
    answers.eventIds.map((id) => ({
      deny_message: denyMessage,
      result: answers.result,
      tool_use_id: id,
      type: "user.tool_confirmation" as const,
    })),
    {
      matches: (event) => event.type === "user.tool_confirmation" && event.tool_use_id === first,
      since: answers.since,
      type: "user.tool_confirmation",
    },
  );
};
