// ---------------------------------------------------------------------------
// Grant-table completeness — the half of the grant table's claim that lives in
// this package, because both sides of it are exports of this package.
//
// CLICKING ⇒ WEIGHED is a TYPE fact (`EVERY_METHOD_IS_WEIGHED`): a host method
// with no row stops agent-grants.ts compiling, naming it. What is left for a
// runtime assertion is the direction a type cannot state — that no capability
// is declared TWICE, granted in one place and denied in another.
//
// Events need no assertion at all: both tables are typed `HostMethod`, so a
// host → UI push is unrepresentable in either.
//
// The other half — ASKING ⇔ GRANTED, that the tools the host actually
// registers are exactly the table's granted rows — is asserted where the tools
// are implemented (apps/web agent-tools.test.ts). It has to be: this package
// declares the policy and implements none of it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  AGENT_GRANTS,
  AGENT_NEVER_GRANTED,
  EVERY_METHOD_IS_WEIGHED,
  KNOWLEDGE_ONLY_CAPABILITIES,
} from "../agent-grants";
import { IPC_METHODS } from "../ipc-registry";

describe("agent grant table ↔ bridge registry", () => {
  it("weighs every host method — a missing row is a compile error, not this test", () => {
    expect(EVERY_METHOD_IS_WEIGHED).toBe(true);
  });

  it("declares each capability exactly once", () => {
    const declared: string[] = [
      ...AGENT_GRANTS.map((grant) => grant.capability),
      ...AGENT_NEVER_GRANTED.flatMap((group) => group.capabilities),
    ];

    const twice = declared.filter((method, i) => declared.indexOf(method) !== i);
    expect(twice, "a capability is both granted and never-granted, or listed twice").toEqual([]);
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
