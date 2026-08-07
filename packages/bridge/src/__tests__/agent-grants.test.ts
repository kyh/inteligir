// ---------------------------------------------------------------------------
// Grant-table completeness — the half of the grant table's claim that lives in
// this package, because both sides of it are exports of this package.
//
// CLICKING ⇒ WEIGHED. Every non-event registry method appears exactly once
// across AGENT_GRANTS ∪ AGENT_NEVER_GRANTED. A channel added later is neither
// granted nor declared denied until someone writes the row — which is the
// moment the question "may the agent do this?" gets asked. Events are excluded
// by construction: a tool is a request/response with no subscriber to be, so
// the table has nothing to say about a host → UI push. That exclusion is
// asserted, not assumed.
//
// The other half — ASKING ⇔ GRANTED, that the tools the host actually
// registers are exactly the table's granted rows — is asserted where the tools
// are implemented (apps/web agent-tools.test.ts). It has to be: this package
// declares the policy and implements none of it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { AGENT_GRANTS, AGENT_NEVER_GRANTED, KNOWLEDGE_ONLY_CAPABILITIES } from "../agent-grants";
import { IPC, IPC_METHODS, type IpcMethod } from "../ipc-registry";

describe("agent grant table ↔ bridge registry", () => {
  it("declares every non-event method exactly once, and no event at all", () => {
    const granted = AGENT_GRANTS.map((grant) => grant.capability).filter(
      (capability): capability is IpcMethod =>
        !(KNOWLEDGE_ONLY_CAPABILITIES as readonly string[]).includes(capability),
    );
    const declared = [...granted, ...AGENT_NEVER_GRANTED.flatMap((group) => group.capabilities)];

    const twice = declared.filter((method, i) => declared.indexOf(method) !== i);
    expect(twice, "a capability is both granted and never-granted, or listed twice").toEqual([]);

    const declaredSet = new Set<string>(declared);
    const unweighed = IPC_METHODS.filter(
      (method) => IPC[method].kind !== "event" && !declaredSet.has(method),
    );
    expect(
      unweighed,
      "bridge methods the agent grant table neither grants nor declares never-granted —\n" +
        "add a row to AGENT_GRANTS (implemented host-side, never over the handler) or to\n" +
        "the AGENT_NEVER_GRANTED group whose reason fits:\n" +
        unweighed.map((method) => `  ${method}`).join("\n"),
    ).toEqual([]);

    expect(
      declared.filter((method) => IPC[method].kind === "event"),
      "events are host → UI pushes; a tool has no subscriber to be, so the table declares none",
    ).toEqual([]);
  });

  it("keeps the no-bridge-twin escape hatch for capabilities that truly have none", () => {
    const shadowed = KNOWLEDGE_ONLY_CAPABILITIES.filter((capability) =>
      (IPC_METHODS as string[]).includes(capability),
    );
    expect(
      shadowed,
      "these DO have a bridge method — name the method so the row stays traceable",
    ).toEqual([]);
  });
});
