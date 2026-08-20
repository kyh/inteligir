// The service's own decisions — which are all about what state the machine is
// in, never about audio. The worker is injected, so nothing here dlopens a
// native binding and every assertion holds on every platform the suite runs
// on.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { VOICE_MODEL } from "../model-catalog";
import { modelDirFor, modelFilePath } from "../model-store";
import {
  ScriptedVoiceService,
  VoiceBusyError,
  VoiceTranscriptionError,
  VoiceUnavailableError,
  WhisperVoiceService,
} from "../voice-service";
import type { VoiceWorkerResponse } from "../worker-protocol";

const workerOk = async (): Promise<VoiceWorkerResponse> => ({ kind: "probed" });

function transcribingWorker(text: string) {
  return async (request: { kind: string }): Promise<VoiceWorkerResponse> =>
    request.kind === "probe" ? { kind: "probed" } : { kind: "transcribed", text };
}

/** A file the size the catalog pins, so `isModelInstalled` believes it. */
async function installFakeModel(modelDir: string): Promise<void> {
  await mkdir(modelDirFor(modelDir, VOICE_MODEL), { recursive: true });
  await writeFile(modelFilePath(modelDir, VOICE_MODEL), Buffer.alloc(VOICE_MODEL.sizeBytes));
}

/** A latch the test opens by hand; `release` exists once the executor ran. */
interface Gate {
  release?: () => void;
}

describe("WhisperVoiceService", () => {
  it("reports a runtime that will not load as unavailable, and refuses both verbs", async () => {
    const service = new WhisperVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: async () => ({
        kind: "failed",
        message: "dlopen: image not found",
        modelUnusable: true,
      }),
    });
    const status = await service.status();
    expect(status).toEqual({
      state: "unavailable",
      detail: expect.stringContaining("dlopen: image not found"),
    });
    await expect(service.install()).rejects.toBeInstanceOf(VoiceUnavailableError);
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
  });

  it("probes once and keeps the answer — a native load is a fact about this build", async () => {
    let probes = 0;
    const service = new WhisperVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: async () => {
        probes += 1;
        return { kind: "probed" };
      },
    });
    await service.status();
    await service.status();
    await service.status();
    expect(probes).toBe(1);
  });

  it("starts with no model, naming what it needs", async () => {
    const service = new WhisperVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: workerOk,
    });
    expect(await service.status()).toEqual({
      state: "no-model",
      model: { id: VOICE_MODEL.id, label: VOICE_MODEL.label, sizeBytes: VOICE_MODEL.sizeBytes },
      lastError: null,
    });
  });

  it("refuses to transcribe without a model, and says how to get one", async () => {
    const service = new WhisperVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: workerOk,
    });
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toThrow(/Settings/u);
  });

  it("transcribes with a model present and refuses once it is removed", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    const service = new WhisperVoiceService({
      modelDir,
      runWorker: transcribingWorker("hello there"),
    });
    // Placed rather than downloaded: the digest the catalog pins is the real
    // model's, so a fetch fake cannot produce a file this service will accept
    // — which is the guard working, and is covered in model-store.test.ts.
    await installFakeModel(modelDir);
    expect((await service.status()).state).toBe("ready");
    expect(await service.transcribe(new ArrayBuffer(2))).toBe("hello there");

    expect((await service.remove()).state).toBe("no-model");
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
  });

  it("refuses a second install while one is installed", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    const service = new WhisperVoiceService({ modelDir, runWorker: workerOk });
    await expect(service.install()).rejects.toBeInstanceOf(VoiceBusyError);
  });

  it("refuses a second dictation while one is in flight", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    // A GATE the test opens by hand, not a timer: the first transcribe holds
    // here until the assertion below has fired, so "the second call arrives
    // while the first is in flight" is a fact rather than a timing bet. A
    // `delay()` raced the second call's own `stat` under a saturated CI and
    // flaked. The executor captures `gate`, which keeps the linter happy.
    const gate: Gate = {};
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const service = new WhisperVoiceService({
      modelDir,
      runWorker: async (request) => {
        if (request.kind === "probe") {
          return { kind: "probed" };
        }
        await held;
        return { kind: "transcribed", text: "first" };
      },
    });
    // Probe first, so the second call is refused for being BUSY rather than
    // simply arriving before the probe resolved.
    await service.status();
    const first = service.transcribe(new ArrayBuffer(2));
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toBeInstanceOf(VoiceBusyError);
    gate.release?.();
    expect(await first).toBe("first");
  });

  it("a decode failure is a transcription error and KEEPS the model", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    const service = new WhisperVoiceService({
      modelDir,
      runWorker: async (request) =>
        request.kind === "probe"
          ? { kind: "probed" }
          : {
              kind: "failed",
              message: "the runtime choked on this clip",
              modelUnusable: false,
            },
    });
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toBeInstanceOf(
      VoiceTranscriptionError,
    );
    // The bytes are fine, the clip was not — the model stays and status is ready.
    expect(existsSync(modelFilePath(modelDir, VOICE_MODEL))).toBe(true);
    expect((await service.status()).state).toBe("ready");
  });

  it("nukes a model that will not LOAD and drops to no-model with the reason", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    const service = new WhisperVoiceService({
      modelDir,
      runWorker: async (request) =>
        request.kind === "probe"
          ? { kind: "probed" }
          : {
              kind: "failed",
              message: "whisper_model_load: failed to open the model",
              modelUnusable: true,
            },
    });
    // A same-size-but-corrupt file passes the readiness check, so it reports
    // ready — and would forever, with no recovery, if a load failure did not
    // nuke it. This is the repro: readiness is size-only, recovery is on load.
    expect((await service.status()).state).toBe("ready");
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
    expect(existsSync(modelFilePath(modelDir, VOICE_MODEL))).toBe(false);
    const after = await service.status();
    expect(after.state).toBe("no-model");
    if (after.state === "no-model") {
      expect(after.lastError).toMatch(/failed to open/u);
    }
  });

  it("reports a failed download as the reason it has no model", async () => {
    const service = new WhisperVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: workerOk,
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    expect((await service.install()).state).toBe("downloading");
    // The install is deliberately NOT awaited — the route answers the status
    // it moved to and the surface polls — so the failure lands a turn later.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await delay(5);
      const status = await service.status();
      if (status.state === "no-model") {
        expect(status.lastError).toMatch(/500/u);
        return;
      }
    }
    throw new Error("the failed download never moved the status back to no-model");
  });
});

describe("ScriptedVoiceService", () => {
  it("is ready with no model on disk and names the sample count it was given", async () => {
    const service = new ScriptedVoiceService();
    expect((await service.status()).state).toBe("ready");
    expect(await service.transcribe(new ArrayBuffer(64))).toBe("scripted dictation of 32 samples");
  });
});
