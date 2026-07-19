import { afterEach, describe, expect, it, vi } from "vitest";

import { setDevFlagsAllowed } from "@repo/bridge/dev-flags";
import {
  applyFauxAgentScript,
  ensureFauxProvider,
  isFauxAgentEnabled,
  resetFauxResponses,
} from "../provider/faux-provider";

// The packaged-build hardening contract for the FAUX side of the dev-flag
// gate (@repo/bridge/dev-flags): INTELIGIR_FAUX_AGENT is honored ONLY when
// boot allowed dev flags (`!platform.isPackaged`). The emulate side lives in
// @repo/connectors' dev-flags.test.ts.
describe("isFauxAgentEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setDevFlagsAllowed(false);
  });

  it("packaged (disallowed): forced off regardless of env", () => {
    setDevFlagsAllowed(false);
    vi.stubEnv("INTELIGIR_FAUX_AGENT", "1");
    expect(isFauxAgentEnabled()).toBe(false);
  });

  it("unpackaged (allowed): env is honored", () => {
    setDevFlagsAllowed(true);
    vi.stubEnv("INTELIGIR_FAUX_AGENT", "1");
    expect(isFauxAgentEnabled()).toBe(true);
  });

  it("unpackaged (allowed) with no env set: stays off", () => {
    setDevFlagsAllowed(true);
    expect(isFauxAgentEnabled()).toBe(false);
  });
});

describe("applyFauxAgentScript", () => {
  it("queues exactly one response per step", () => {
    applyFauxAgentScript({
      steps: [
        {
          text: "Editing…",
          toolCalls: [
            {
              name: "edit",
              arguments: { path: "./vault/a.md", edits: [{ oldText: "x", newText: "y" }] },
            },
          ],
        },
        { text: "Done." },
      ],
    });
    expect(ensureFauxProvider().getPendingResponseCount()).toBe(2);
    resetFauxResponses();
  });

  it("restores the self-refilling echo on empty steps", () => {
    applyFauxAgentScript({ steps: [{ text: "one" }] });
    applyFauxAgentScript({ steps: [] });
    // The echo is a single queued factory that re-appends itself per turn.
    expect(ensureFauxProvider().getPendingResponseCount()).toBe(1);
  });
});
