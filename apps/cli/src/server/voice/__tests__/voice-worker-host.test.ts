// loads the real native binding. do not add a bad-model case: onnxruntime raises a c++
// exception that aborts the process rather than a catchable error, so it would crash the
// runner; model-store's sha gate is what keeps production off that path.

import { describe, expect, it } from "vitest";
import { runVoiceWorker } from "../voice-worker-host";

describe("the real transcription worker", () => {
  it("loads the native binding on a probe", async () => {
    const answer = await runVoiceWorker({ kind: "probe" });
    expect(answer).toEqual({ kind: "probed" });
  }, 30_000); // dlopening onnxruntime costs more than vitest's 5 s default.
});
