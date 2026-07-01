// Runtime completeness: spinning the real handler groups against
// collectHandlers proves every renderer-initiated method the host owns has a
// live registration (collectHandlers throws otherwise) — the boot-time
// guarantee, exercised without booting a shell.

import { describe, expect, it } from "vitest";

import { HOST_METHODS, collectHandlers } from "../lib/handler-registry";
import { registerAllHandlers } from "../handlers/register-handlers";

describe("registerAllHandlers", () => {
  it("registers exactly the host-owned registry methods", () => {
    const handlers = collectHandlers(registerAllHandlers);
    expect(Object.keys(handlers).toSorted()).toEqual([...HOST_METHODS].toSorted());
  });
});
