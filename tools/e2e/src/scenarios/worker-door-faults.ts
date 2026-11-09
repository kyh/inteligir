import { clientBuildHeaders } from "@repo/contract/client-build";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { V1_RPC_PATH } from "@repo/contract/v1";
import { expect, expectEq } from "../harness/assert";
import { PHONE_BUILD } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { Scenario } from "../harness/scenario";

const BUILD = clientBuildHeaders(PHONE_BUILD);

export const workerDoorFaults: Scenario = {
  description:
    "a throw in a door, through the built Worker's Start route, answered in the door's own protocol: the wire's an oRPC INTERNAL_SERVER_ERROR a client reads as a fault, the files' a plain 500, never Start's own JSON 500",
  name: "worker-door-faults",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    // a floor that is no version throws in each door that reads it, before any procedure runs
    const worker = await ctx.cloudWorker({ vars: { MIN_CLIENT_BUILD: "no-version" } });

    ctx.log("a throw in the wire's door is oRPC's INTERNAL_SERVER_ERROR");
    const call = await fetch(`${worker.origin}${V1_RPC_PATH}/account/devices/list`, {
      body: "{}",
      headers: { ...BUILD, "content-type": "application/json" },
      method: "POST",
    });
    const fault: unknown = await call.json();
    expectEq(call.status, 500, "a throw in the wire's door");
    expect(
      JSON.stringify(fault).includes('"code":"INTERNAL_SERVER_ERROR"'),
      `a throw in the wire's door answered ${JSON.stringify(fault)}, not oRPC's INTERNAL_SERVER_ERROR`,
    );

    ctx.log("a throw in the files' door is a plain 500");
    const file = await fetch(`${worker.origin}${V1_BLOBS_PATH}/${"a".repeat(64)}`, {
      headers: BUILD,
    });
    expectEq(
      [file.status, await file.text()],
      [500, "internal error"],
      "a throw in the files' door",
    );
  },
};
