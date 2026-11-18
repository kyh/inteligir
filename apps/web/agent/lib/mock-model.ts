import { setTimeout as sleep } from "node:timers/promises";

import { mockStep } from "@repo/service/agent/mock-directives";
import { mockModel } from "eve/evals";
import type { MockModelRequest, MockModelResponse } from "eve/evals";

// the tool results the model read since the person's latest message: its step in their script
const stepOf = ({ messages }: MockModelRequest): number => {
  const lastUser = messages.findLastIndex(({ role }) => role === "user");
  return messages.slice(lastUser + 1).filter(({ role }) => role === "tool").length;
};

const reply = async (request: MockModelRequest): Promise<MockModelResponse> => {
  const next = mockStep(request.lastUserMessage ?? "", stepOf(request));
  if (next.kind === "call") {
    return { toolCalls: [{ input: next.input, name: next.tool }] };
  }
  await sleep(next.afterMs);
  return { text: next.text };
};

// eve's mock model, playing the script @repo/service/agent/mock-directives reads
export const mockAgentModel = mockModel(reply);
