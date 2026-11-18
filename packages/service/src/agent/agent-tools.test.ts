import { randomUUID } from "node:crypto";

import { LIBRARY_TOOLS } from "@repo/contract/library/agent-tools";
import type { LibraryToolName } from "@repo/contract/library/agent-tools";
import { dbSuite } from "@repo/db/test-database";
import { expect, it } from "vitest";

import type { LibraryPrincipal } from "../library/library-principal";
import { makeAccount } from "../test-support/library-fixture";
import { AGENT_TOOLS, agentOpId, callAgentTool } from "./agent-tools";
import type { AgentTool } from "./agent-tools";

const toolNamed = (name: LibraryToolName): AgentTool => {
  const tool = AGENT_TOOLS.find((each) => each.name === name);
  if (tool === undefined) {
    throw new Error(`the agent has no ${name} tool`);
  }
  return tool;
};

it("calls the library's tools its rows route, by name, each written without an op id", () => {
  const names = AGENT_TOOLS.map(({ name }) => name);
  expect(names).toStrictEqual(names.toSorted());
  expect(names.every((name) => Object.hasOwn(LIBRARY_TOOLS, name))).toBe(true);
  expect(names).toContain("create_note");
  expect(names).not.toContain("read_guide");
  for (const tool of AGENT_TOOLS) {
    expect(JSON.stringify(tool.input), tool.name).not.toContain('"opId"');
    expect(tool.input).toMatchObject({ type: "object" });
  }
  expect(AGENT_TOOLS.find(({ name }) => name === "create_note")).toMatchObject({
    input: { required: ["markdown"] },
    writes: true,
  });
});

it("keeps one op id for a call however often its step runs, and another for any other call", () => {
  const opId = agentOpId("sess_A", "call_1");
  expect(opId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(agentOpId("sess_A", "call_1")).toBe(opId);
  expect(agentOpId("sess_B", "call_1")).not.toBe(opId);
});

dbSuite("a library tool the agent calls", () => {
  it("tells it a new note nests too deep, not that it is too large", async () => {
    const accountId = await makeAccount();
    const turn: LibraryPrincipal = {
      accountId,
      actor: { kind: "agent", threadId: randomUUID(), turn: 1 },
    };
    await expect(
      callAgentTool({ principal: turn }, toolNamed("create_note"), {
        callId: "call_1",
        eveSessionId: "sess_A",
        input: { markdown: `${"> ".repeat(400)}too deep` },
      }),
    ).resolves.toStrictEqual({
      kind: "failed",
      text: "That new text nests deeper than an item holds. Nest its lists and quotes fewer levels deep.",
    });
  });
});
