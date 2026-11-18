import { setTimeout as sleep } from "node:timers/promises";

import { AGENT_SYSTEM_PROMPT } from "@repo/service/agent/agent-prompt";
import { mockStep, mockUsageOf } from "@repo/service/agent/mock-directives";
import { mockModel } from "eve/evals";
import type { MockModelRequest, MockModelResponse } from "eve/evals";

// the tool results the model read since the person's latest message: its step in their script
const stepOf = ({ messages }: MockModelRequest): number => {
  const lastUser = messages.findLastIndex(({ role }) => role === "user");
  return messages.slice(lastUser + 1).filter(({ role }) => role === "tool").length;
};

// eve's label on the client context it hands the model, this turn's alone
const CLIENT_CONTEXT = "Client context:\n";

const screenOf = ({ messages }: MockModelRequest): string | null => {
  const sent = messages.findLast(
    ({ role, text }) => role === "user" && text.startsWith(CLIENT_CONTEXT),
  );
  return sent === undefined ? null : sent.text.slice(CLIENT_CONTEXT.length);
};

// what the model read after the agent's own prompt, where eve puts the person's filing rules
const rulesOf = ({ messages }: MockModelRequest): string | null => {
  const system = messages
    .filter(({ role }) => role === "system")
    .map(({ text }) => text)
    .join("\n");
  const at = system.indexOf(AGENT_SYSTEM_PROMPT);
  const after = at === -1 ? "" : system.slice(at + AGENT_SYSTEM_PROMPT.length).trim();
  return after === "" ? null : after;
};

const reply = async (request: MockModelRequest): Promise<MockModelResponse> => {
  const message = request.lastUserMessage ?? "";
  const next = mockStep(message, stepOf(request), {
    rules: rulesOf(request),
    screen: screenOf(request),
  });
  const usage = mockUsageOf(message);
  if (next.kind === "call") {
    return { toolCalls: [{ input: next.input, name: next.tool }], usage };
  }
  await sleep(next.afterMs);
  return { text: next.text, usage };
};

// eve's mock model, playing the script @repo/service/agent/mock-directives reads
export const mockAgentModel = mockModel(reply);
