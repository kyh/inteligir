// The built-in agent's system prompt: @repo/agent-skills as it stands, the agent's own instructions,
// the hub, then every skill in the order the hub lists them, with nothing of an account or a request
// in it, so its bytes change only with those files and every conversation of every account reads
// one cached prefix (`./thread-request`).

import builtInAgent from "@repo/agent-skills/built-in-agent.md?raw";
import canvas from "@repo/agent-skills/skills/inteligir-canvas/SKILL.md?raw";
import fields from "@repo/agent-skills/skills/inteligir-fields/SKILL.md?raw";
import formulas from "@repo/agent-skills/skills/inteligir-formulas/SKILL.md?raw";
import html from "@repo/agent-skills/skills/inteligir-html/SKILL.md?raw";
import items from "@repo/agent-skills/skills/inteligir-items/SKILL.md?raw";
import links from "@repo/agent-skills/skills/inteligir-links/SKILL.md?raw";
import hub from "@repo/agent-skills/skills/inteligir-notes/SKILL.md?raw";
import writing from "@repo/agent-skills/skills/inteligir-writing/SKILL.md?raw";

// the hub's "Focused Contracts", in its order
export const FOCUSED_SKILLS = [
  ["inteligir-writing", writing],
  ["inteligir-items", items],
  ["inteligir-fields", fields],
  ["inteligir-links", links],
  ["inteligir-formulas", formulas],
  ["inteligir-canvas", canvas],
  ["inteligir-html", html],
] as const;

export const AGENT_SYSTEM_PROMPT = [builtInAgent, hub, ...FOCUSED_SKILLS.map(([, text]) => text)]
  .map((part) => part.trim())
  .join("\n\n");
