import { describe, expect, it } from "vitest";

import { harnessReadiness } from "../agents-schema";
import type { HarnessStatus, VendorAccount } from "../agents-schema";

const bundled = (account: VendorAccount): HarnessStatus => ({
  account,
  displayName: "Claude",
  id: "claude",
  runtime: "bundled",
  vendorApp: "Claude Code",
});

describe("harness readiness", () => {
  it("is unavailable when this copy of the app is missing the runtime", () => {
    expect(
      harnessReadiness({
        displayName: "Claude",
        id: "claude",
        runtime: "missing",
        vendorApp: "Claude Code",
      }),
    ).toBe("unavailable");
  });

  it("is ready when the vendor says it is signed in", () => {
    expect(
      harnessReadiness(
        bundled({ email: "ada@example.com", label: "Claude Max", state: "signed-in" }),
      ),
    ).toBe("ready");
  });

  it("is signed out only when the vendor says so", () => {
    expect(harnessReadiness(bundled({ state: "signed-out" }))).toBe("signed-out");
  });

  it("is unknown when the vendor did not answer", () => {
    expect(harnessReadiness(bundled({ detail: "timed out", state: "unknown" }))).toBe("unknown");
  });
});
