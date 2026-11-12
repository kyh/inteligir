// The built-in agent's prompt: every skill the hub lists, in its order, and short enough to cache.

import hub from "@repo/agent-skills/skills/inteligir-notes/SKILL.md?raw";
import { expect, it } from "vitest";

import { AGENT_SYSTEM_PROMPT, FOCUSED_SKILLS } from "./agent-prompt";

// a prompt past this is one no turn should pay to cache: about 25,000 tokens
const SYSTEM_MAX_CHARS = 100_000;

it("carries every skill the hub lists, in its order, under 100,000 characters", () => {
  const start = hub.indexOf("## Focused Contracts");
  const index = hub.slice(start, hub.indexOf("\n## ", start));
  const listed = [...index.matchAll(/`(?<skill>inteligir-[a-z-]+)`/gu)].map(
    (match) => match.groups?.skill,
  );
  expect(FOCUSED_SKILLS.map(([skill]) => skill)).toStrictEqual(listed);
  expect(AGENT_SYSTEM_PROMPT.length).toBeLessThanOrEqual(SYSTEM_MAX_CHARS);
});
