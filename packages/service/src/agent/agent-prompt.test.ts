import { expect, it } from "vitest";

import { AGENT_SYSTEM_PROMPT } from "./agent-prompt";

const SYSTEM_MAX_CHARS = 100_000;

it("is short enough to cache", () => {
  expect(AGENT_SYSTEM_PROMPT.length).toBeLessThanOrEqual(SYSTEM_MAX_CHARS);
});
