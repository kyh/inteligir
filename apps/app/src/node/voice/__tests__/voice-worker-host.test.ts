// The one voice test that spawns the REAL worker and loads the REAL native
// binding — everything else injects `runWorker` to stay platform-neutral. This
// is where the two claims the rest of the code depends on are actually proven:
// that the probe LOADS the binding (not just imports the JS wrapper), and that
// a model which will not open reports `modelUnusable` so the cache can nuke it.
//
// It runs on the platforms this product ships a prebuild for (the same class
// the smokes and e2e run on). On a platform with no usable binding the probe
// answers `failed` instead of `probed`, which is the honest signal that
// dictation cannot run there — not a flake — so the assertion is left strict.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { runVoiceWorker } from "../voice-worker-host";

describe("the real transcription worker", () => {
  // Spawning a thread, dlopening the addon and letting whisper.cpp bring up its
  // Metal backend costs more than vitest's 5 s default — the worker's own
  // budget is 60 s, so these get room rather than a false timeout.
  const WORKER_TEST_TIMEOUT_MS = 30_000;

  it(
    "loads the native binding on a probe",
    async () => {
      // The regression this pins: a probe that only `import`ed the wrapper
      // passed here too, because the wrapper loads without the addon. Forcing
      // the load is what makes `probed` mean the addon actually dlopened.
      const answer = await runVoiceWorker({ kind: "probe" });
      expect(answer).toEqual({ kind: "probed" });
    },
    WORKER_TEST_TIMEOUT_MS,
  );

  it(
    "reports a model that will not open as modelUnusable, not a bad clip",
    async () => {
      const modelDir = makeTempDir("inteligir-voice-worker-");
      const garbage = join(modelDir, "model.bin");
      await writeFile(garbage, Buffer.from("this is not a ggml model"));

      const answer = await runVoiceWorker({
        kind: "transcribe",
        modelPath: garbage,
        pcm: new ArrayBuffer(3200),
      });
      expect(answer.kind).toBe("failed");
      if (answer.kind === "failed") {
        // The load threw, not the decode — which is what tells the service to
        // delete the file rather than blame the audio.
        expect(answer.modelUnusable).toBe(true);
        expect(answer.message.length).toBeGreaterThan(0);
      }
    },
    WORKER_TEST_TIMEOUT_MS,
  );
});
