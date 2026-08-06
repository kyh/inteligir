// Runtime completeness: spinning the real handler groups against
// collectHandlers proves every renderer-initiated method the host owns has a
// live registration (collectHandlers throws otherwise) — the boot-time
// guarantee, exercised without booting a shell.

import { describe, expect, it } from "vitest";

import { createHostServices } from "../boot/host-services";
import { HOST_METHODS, collectHandlers } from "../handlers/handler-registry";
import { registerAllHandlers } from "../handlers/register-handlers";

describe("registerAllHandlers", () => {
  it("registers exactly the host-owned registry methods", () => {
    // The node services resolve their singletons on property READ, so building
    // the set and registering over it touches no store and needs no platform.
    const services = createHostServices();
    const handlers = collectHandlers((handle) => registerAllHandlers(handle, services));
    expect(Object.keys(handlers).toSorted()).toEqual([...HOST_METHODS].toSorted());
  });
});
