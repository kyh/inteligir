// The pure dev-flag gate contract (dev-flags.ts): fail-closed until a host
// boot decides, flipped only through the single setter. The consumer-side
// packaged-refusal contracts live with the consumers — @repo/agent's
// faux-provider.test.ts and @repo/connectors' dev-flags.test.ts.

import { afterEach, describe, expect, it } from "vitest";

import { areDevFlagsAllowed, setDevFlagsAllowed } from "../dev-flags";

afterEach(() => setDevFlagsAllowed(false));

describe("dev-flags gate", () => {
  it("is fail-closed until boot decides", () => {
    expect(areDevFlagsAllowed()).toBe(false);
  });

  it("reflects the boot decision through the single setter", () => {
    setDevFlagsAllowed(true);
    expect(areDevFlagsAllowed()).toBe(true);
    setDevFlagsAllowed(false);
    expect(areDevFlagsAllowed()).toBe(false);
  });
});
