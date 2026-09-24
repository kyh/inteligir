import { describe, expect, it } from "vitest";

import { harnessReadiness } from "../agents-schema";
import type { HarnessProbe } from "../agents-schema";

const probe = (overrides: Partial<HarnessProbe>): HarnessProbe => ({
  cliPath: "/usr/local/bin/claude",
  credentials: "present",
  displayName: "Claude Code",
  id: "claude",
  loginCommand: "claude /login",
  ...overrides,
});

describe("harness readiness", () => {
  it("is not-installed with no CLI on PATH, whatever the credentials say", () => {
    expect(harnessReadiness(probe({ cliPath: null }))).toBe("not-installed");
    expect(harnessReadiness(probe({ cliPath: null, credentials: "absent" }))).toBe("not-installed");
  });

  it("is ready with the CLI and a credential", () => {
    expect(harnessReadiness(probe({}))).toBe("ready");
  });

  it("needs a sign-in only when the credential is known to be absent", () => {
    expect(harnessReadiness(probe({ credentials: "absent" }))).toBe("needs-sign-in");
  });

  it("is unknown when the credential store could not be read", () => {
    expect(harnessReadiness(probe({ credentials: "unknown" }))).toBe("unknown");
  });
});
