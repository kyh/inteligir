// The one voice suite that spawns the REAL worker and loads the REAL native
// binding — everything else injects the workers to stay platform-neutral. What
// it proves is the claim the rest of the code depends on: that the probe LOADS
// the addon (not just imports a JS wrapper), so a platform whose binary cannot
// load answers `unavailable` at the switch rather than at the first dictation.
//
// It runs on the platforms this product ships a prebuild for (the same class the
// smokes and e2e run on). On a platform with no usable binding the probe answers
// `failed` instead of `probed`, which is the honest signal — not a flake — so
// the assertion is left strict.
//
// It does NOT feed the worker a garbage model. onnxruntime does not translate a
// parse failure into a catchable JS error — it raises a C++ `Ort::Exception`
// that aborts the process — so a "bad model" test would crash the runner rather
// than assert. Production never reaches that path: `model-store` verifies the
// archive's sha256 against the pin before installing, so only the exact bytes
// that DO load ever reach the recognizer. The service's `modelUnusable` recovery
// (nuke and drop to `no-model`) is driven through an injected worker instead —
// see `voice-service.test.ts` and `stream-session.test.ts`.

import { describe, expect, it } from "vitest";
import { runVoiceWorker } from "../voice-worker-host";

describe("the real transcription worker", () => {
  it("loads the native binding on a probe", async () => {
    const answer = await runVoiceWorker({ kind: "probe" });
    expect(answer).toEqual({ kind: "probed" });
  }, 30_000); // default. // Spawning a thread and dlopening onnxruntime costs more than vitest's 5 s
});
