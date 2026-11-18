import { setTimeout as sleep } from "node:timers/promises";

import { AGENT_SYSTEM_PROMPT } from "@repo/service/agent/agent-prompt";
import { mockStep, mockUsageOf } from "@repo/service/agent/mock-directives";
import { mockModel } from "eve/evals";
import type { MockModelRequest, MockModelResponse } from "eve/evals";

const stepOf = ({ messages }: MockModelRequest) => {
  const lastUser = messages.findLastIndex(({ role }) => role === "user");

  return messages.slice(lastUser + 1).filter(({ role }) => role === "tool").length;
};

const CLIENT_CONTEXT = "Client context:\n";

const screenOf = ({ messages }: MockModelRequest) => {
  const sent = messages.findLast(
    ({ role, text }) => role === "user" && text.startsWith(CLIENT_CONTEXT),
  );

  return sent === undefined ? null : sent.text.slice(CLIENT_CONTEXT.length);
};

const rulesOf = ({ messages }: MockModelRequest) => {
  const system = messages
    .filter(({ role }) => role === "system")
    .map(({ text }) => text)
    .join("\n");

  const at = system.indexOf(AGENT_SYSTEM_PROMPT);
  const after = at === -1 ? "" : system.slice(at + AGENT_SYSTEM_PROMPT.length).trim();

  return after === "" ? null : after;
};

const reply = async (request: MockModelRequest) => {
  const message = request.lastUserMessage ?? "";

  const next = mockStep(message, stepOf(request), {
    rules: rulesOf(request),
    screen: screenOf(request),
  });

  const usage = mockUsageOf(message);

  if (next.kind === "call") {
    return {
      toolCalls: [{ input: next.input, name: next.tool }],
      usage,
    } satisfies MockModelResponse;
  }

  await sleep(next.afterMs);

  return { text: next.text, usage } satisfies MockModelResponse;
};

export const mockAgentModel = mockModel(reply);
