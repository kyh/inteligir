// The service's own decisions — which are all about what state the machine is
// in, never about audio. The workers are injected, so nothing here dlopens a
// native binding and every assertion holds on every platform the suite runs on.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { VOICE_MODEL } from "../model-catalog";
import { modelDirFor, resolveModelFiles } from "../model-store";
import {
  ParakeetVoiceService,
  ScriptedVoiceService,
  VoiceBusyError,
  VoiceTranscriptionError,
  VoiceUnavailableError,
} from "../voice-service";
import type { VoiceStreamWorkerCallbacks, VoiceStreamWorkerHandle } from "../voice-worker-host";
import type { VoiceModelFiles, VoiceWorkerResponse } from "../worker-protocol";

/** Poll until a condition holds — the stream session's setup is async (a probe
 *  and a filesystem check), so a single tick can land before it settles. */
async function until(predicate: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("condition not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const workerOk = async (): Promise<VoiceWorkerResponse> => ({ kind: "probed" });

function transcribingWorker(text: string) {
  return async (request: { kind: string }): Promise<VoiceWorkerResponse> =>
    request.kind === "probe" ? { kind: "probed" } : { kind: "transcribed", text };
}

/** The four files the catalog names, each non-empty, so `isModelInstalled`
 *  believes it. */
async function installFakeModel(modelDir: string): Promise<void> {
  await mkdir(modelDirFor(modelDir, VOICE_MODEL), { recursive: true });
  const files = resolveModelFiles(modelDir, VOICE_MODEL);
  for (const path of Object.values(files)) {
    await writeFile(path, "x");
  }
}

/** A no-op streaming worker whose callbacks a test drives by hand. */
function captureSpawn() {
  let count = 0;
  let disposeCount = 0;
  let last: { model: VoiceModelFiles; callbacks: VoiceStreamWorkerCallbacks } | null = null;
  const spawn = (
    model: VoiceModelFiles,
    callbacks: VoiceStreamWorkerCallbacks,
  ): VoiceStreamWorkerHandle => {
    count += 1;
    last = { model, callbacks };
    return {
      pushPcm: () => undefined,
      finalize: () => undefined,
      dispose: async () => {
        disposeCount += 1;
      },
    };
  };
  return { spawn, spawnCount: () => count, latest: () => last, disposed: () => disposeCount };
}

/** A latch the test opens by hand; `release` exists once the executor ran. */
interface Gate {
  release?: () => void;
}

describe("ParakeetVoiceService", () => {
  it("reports a runtime that will not load as unavailable, and refuses both verbs", async () => {
    const service = new ParakeetVoiceService({
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
    const service = new ParakeetVoiceService({
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
    const service = new ParakeetVoiceService({
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
    const service = new ParakeetVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: workerOk,
    });
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toThrow(/Settings/u);
  });

  it("transcribes with a model present and refuses once it is removed", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    const service = new ParakeetVoiceService({
      modelDir,
      runWorker: transcribingWorker("hello there"),
    });
    // Placed rather than downloaded: the digest the catalog pins is the real
    // model's, so a fetch fake cannot produce files this service will accept.
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
    const service = new ParakeetVoiceService({ modelDir, runWorker: workerOk });
    await expect(service.install()).rejects.toBeInstanceOf(VoiceBusyError);
  });

  it("refuses a second dictation while one is in flight", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    const gate: Gate = {};
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const service = new ParakeetVoiceService({
      modelDir,
      runWorker: async (request) => {
        if (request.kind === "probe") {
          return { kind: "probed" };
        }
        await held;
        return { kind: "transcribed", text: "first" };
      },
    });
    await service.status();
    const first = service.transcribe(new ArrayBuffer(2));
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toBeInstanceOf(VoiceBusyError);
    gate.release?.();
    expect(await first).toBe("first");
  });

  it("a decode failure is a transcription error and KEEPS the model", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    const service = new ParakeetVoiceService({
      modelDir,
      runWorker: async (request) =>
        request.kind === "probe"
          ? { kind: "probed" }
          : { kind: "failed", message: "the runtime choked on this clip", modelUnusable: false },
    });
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toBeInstanceOf(
      VoiceTranscriptionError,
    );
    expect(existsSync(resolveModelFiles(modelDir, VOICE_MODEL).encoder)).toBe(true);
    expect((await service.status()).state).toBe("ready");
  });

  it("nukes a model that will not LOAD and drops to no-model with the reason", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    const service = new ParakeetVoiceService({
      modelDir,
      runWorker: async (request) =>
        request.kind === "probe"
          ? { kind: "probed" }
          : { kind: "failed", message: "failed to open the model", modelUnusable: true },
    });
    expect((await service.status()).state).toBe("ready");
    await expect(service.transcribe(new ArrayBuffer(2))).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
    expect(existsSync(modelDirFor(modelDir, VOICE_MODEL))).toBe(false);
    const after = await service.status();
    expect(after.state).toBe("no-model");
    if (after.state === "no-model") {
      expect(after.lastError).toMatch(/failed to open/u);
    }
  });

  it("reports a failed download as the reason it has no model", async () => {
    const service = new ParakeetVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: workerOk,
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    expect((await service.install()).state).toBe("downloading");
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

  it("refuses a streaming session with no model, without spawning a worker", async () => {
    const spawn = captureSpawn();
    const service = new ParakeetVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: workerOk,
      spawnStreamWorker: spawn.spawn,
    });
    const errors: string[] = [];
    service.createStreamSession({
      onPartial: () => undefined,
      onFinal: () => undefined,
      onError: (message) => errors.push(message),
    });
    await until(() => errors.length > 0);
    expect(spawn.spawnCount()).toBe(0);
    expect(errors[0]).toMatch(/Settings/u);
  });

  it("spawns a streaming worker with the resolved model files and relays its final", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    const spawn = captureSpawn();
    const service = new ParakeetVoiceService({
      modelDir,
      runWorker: workerOk,
      spawnStreamWorker: spawn.spawn,
    });
    const finals: string[] = [];
    const session = service.createStreamSession({
      onPartial: () => undefined,
      onFinal: (text) => finals.push(text),
      onError: () => undefined,
    });
    await until(() => spawn.spawnCount() === 1);
    expect(spawn.latest()?.model.encoder).toContain(VOICE_MODEL.files.encoder);
    spawn.latest()?.callbacks.onFinal("streamed text");
    expect(finals).toEqual(["streamed text"]);
    await session.dispose();
  });

  it("nukes the model when a streaming worker reports it unusable", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    const spawn = captureSpawn();
    const service = new ParakeetVoiceService({
      modelDir,
      runWorker: workerOk,
      spawnStreamWorker: spawn.spawn,
    });
    const errors: string[] = [];
    service.createStreamSession({
      onPartial: () => undefined,
      onFinal: () => undefined,
      onError: (message) => errors.push(message),
    });
    await until(() => spawn.latest() !== null);
    spawn.latest()?.callbacks.onError("could not open the model", true);
    await until(() => errors.length > 0);
    expect(existsSync(modelDirFor(modelDir, VOICE_MODEL))).toBe(false);
    expect(errors[0]).toMatch(/removed/u);
  });
});

describe("ScriptedVoiceService", () => {
  it("is ready with no model on disk and names the sample count it was given", async () => {
    const service = new ScriptedVoiceService();
    expect((await service.status()).state).toBe("ready");
    expect(await service.transcribe(new ArrayBuffer(64))).toBe("scripted dictation of 32 samples");
  });

  it("streams scripted partials and a final over a session", () => {
    const service = new ScriptedVoiceService();
    const partials: string[] = [];
    const finals: string[] = [];
    const session = service.createStreamSession({
      onPartial: (text) => partials.push(text),
      onFinal: (text) => finals.push(text),
      onError: () => undefined,
    });
    session.pushPcm(new ArrayBuffer(20));
    session.finalize();
    expect(partials).toEqual(["scripted dictation of 10 samples"]);
    expect(finals).toEqual(["scripted dictation of 10 samples"]);
  });
});
