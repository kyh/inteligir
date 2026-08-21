// The mic button never hides, so what it SAYS in each state is the whole of
// the affordance — and the issue's requirement is that it states what it needs
// rather than disappearing. This pins the sentence per state, and that a ready
// runtime says nothing at all.

import type { VoiceStatusResponse } from "@repo/server-contract/voice";
import { describe, expect, it } from "vitest";
import { micBlockedReason } from "../mic-button";

const MODEL = {
  id: "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8",
  label: "Parakeet streaming (English)",
  sizeBytes: 105_913_204,
};

describe("micBlockedReason", () => {
  it("says the runtime is still being asked about before the status arrives", () => {
    expect(micBlockedReason(undefined)).toMatch(/Checking/u);
  });

  it("carries the server's own sentence when the machine cannot transcribe", () => {
    const status: VoiceStatusResponse = {
      state: "unavailable",
      detail: "Dictation cannot run on this machine: dlopen failed",
    };
    expect(micBlockedReason(status)).toBe(status.detail);
  });

  it("names the model AND its size, so nobody starts a download blind", () => {
    const reason = micBlockedReason({ state: "no-model", model: MODEL, lastError: null });
    expect(reason).toContain("Parakeet streaming (English)");
    expect(reason).toContain("106 MB");
    expect(reason).toContain("Settings");
  });

  it("reports download progress as a percentage of the pinned size", () => {
    expect(
      micBlockedReason({ state: "downloading", model: MODEL, receivedBytes: MODEL.sizeBytes / 2 }),
    ).toContain("50%");
  });

  it("says the once-only preparation is happening", () => {
    expect(micBlockedReason({ state: "preparing", model: MODEL })).toMatch(/once/u);
  });

  it("blocks nothing when the model is ready", () => {
    expect(micBlockedReason({ state: "ready", model: MODEL })).toBeNull();
  });
});
