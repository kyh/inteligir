import { LIBRARY_TOOLS } from "@repo/contract/library/agent-tools";
import { expect, it } from "vitest";

import { AGENT_TOOLS, agentOpId } from "./agent-tools";

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
