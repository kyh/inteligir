import type { VoiceStatusResponse } from "@repo/api/local/voice/voice-schema";
import { describe, expect, it } from "vitest";
import { micBlockedReason } from "../mic-button";

const MODEL = {
  id: "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8",
  label: "Parakeet streaming (English)",
  sizeBytes: 105_913_204,
};

describe("micBlockedReason", () => {
  it("says the runtime is still being asked about before the status arrives", () => {
    expect(micBlockedReason()).toMatch(/Checking/u);
  });

  it("carries the server's own sentence when the machine cannot transcribe", () => {
    const status: VoiceStatusResponse = {
      detail: "Dictation cannot run on this machine: dlopen failed",
      state: "unavailable",
    };
    expect(micBlockedReason(status)).toBe(status.detail);
  });

  it("names the model AND its size, so nobody starts a download blind", () => {
    const reason = micBlockedReason({ lastError: null, model: MODEL, state: "no-model" });
    expect(reason).toContain("Parakeet streaming (English)");
    expect(reason).toContain("106 MB");
    expect(reason).toContain("Settings");
  });

  it("reports download progress as a percentage of the pinned size", () => {
    expect(
      micBlockedReason({ model: MODEL, receivedBytes: MODEL.sizeBytes / 2, state: "downloading" }),
    ).toContain("50%");
  });

  it("says the once-only preparation is happening", () => {
    expect(micBlockedReason({ model: MODEL, state: "preparing" })).toMatch(/once/u);
  });

  it("blocks nothing when the model is ready", () => {
    expect(micBlockedReason({ model: MODEL, state: "ready" })).toBeNull();
  });
});
