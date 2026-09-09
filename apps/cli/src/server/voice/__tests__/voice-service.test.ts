import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { VOICE_MODEL } from "../model-catalog";
import { modelDirFor, resolveModelFiles } from "../model-store";
import { createScriptedVoiceService } from "../scripted-voice-service";
import { VoiceBusyError, VoiceUnavailableError } from "../voice-errors";
import { ParakeetVoiceService } from "../voice-service";
import type { VoiceStreamWorkerCallbacks, VoiceStreamWorkerHandle } from "../voice-worker-host";
import type { VoiceModelFiles, VoiceWorkerResponse } from "../worker-protocol";

// oxlint-disable-next-line require-await -- the worker port is async; this fake answers from memory
const workerOk = async (): Promise<VoiceWorkerResponse> => ({ kind: "probed" });

// non-empty, or isModelInstalled refuses it.
const installFakeModel = async (modelDir: string): Promise<void> => {
  await mkdir(modelDirFor(modelDir, VOICE_MODEL), { recursive: true });
  const { decoder, encoder, joiner, tokens } = resolveModelFiles(modelDir, VOICE_MODEL);
  for (const file of [decoder, encoder, joiner, tokens]) {
    await writeFile(file, "x");
  }
};

const captureSpawn = () => {
  let count = 0;
  let disposeCount = 0;
  let last: { model: VoiceModelFiles; callbacks: VoiceStreamWorkerCallbacks } | null = null;
  const spawn = (
    model: VoiceModelFiles,
    callbacks: VoiceStreamWorkerCallbacks,
  ): VoiceStreamWorkerHandle => {
    count += 1;
    last = { callbacks, model };
    return {
      dispose: () => {
        disposeCount += 1;
      },
      finalize: () => {},
      pushPcm: () => {},
    };
  };
  return { disposed: () => disposeCount, latest: () => last, spawn, spawnCount: () => count };
};

describe("ParakeetVoiceService", () => {
  it("reports a runtime that will not load as unavailable, and refuses install", async () => {
    const service = new ParakeetVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      // oxlint-disable-next-line require-await -- the worker port is async; this fake answers from memory
      runWorker: async () => ({
        kind: "failed",
        message: "dlopen: image not found",
        modelUnusable: true,
      }),
    });
    const status = await service.status();
    expect(status.state).toBe("unavailable");
    if (status.state !== "unavailable") {
      throw new Error("unreachable");
    }
    expect(status.detail).toContain("dlopen: image not found");
    await expect(service.install()).rejects.toBeInstanceOf(VoiceUnavailableError);
  });

  it("probes once and keeps the answer — a native load is a fact about this build", async () => {
    let probes = 0;
    const service = new ParakeetVoiceService({
      modelDir: makeTempDir("inteligir-voice-"),
      // oxlint-disable-next-line require-await -- the worker port is async; this fake answers from memory
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
      lastError: null,
      model: { id: VOICE_MODEL.id, label: VOICE_MODEL.label, sizeBytes: VOICE_MODEL.sizeBytes },
      state: "no-model",
    });
  });

  it("reads ready with a model present and drops to no-model once it is removed", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    const service = new ParakeetVoiceService({ modelDir, runWorker: workerOk });
    // placed, not downloaded: the pinned digest is the real model's, so no fetch fake passes it.
    await installFakeModel(modelDir);
    const installed = await service.status();
    expect(installed.state).toBe("ready");
    const removed = await service.remove();
    expect(removed.state).toBe("no-model");
  });

  it("refuses a second install while one is installed", async () => {
    const modelDir = makeTempDir("inteligir-voice-");
    await installFakeModel(modelDir);
    const service = new ParakeetVoiceService({ modelDir, runWorker: workerOk });
    await expect(service.install()).rejects.toBeInstanceOf(VoiceBusyError);
  });

  it("refuses a second install issued in the SAME TICK — one download, not two", async () => {
    // both calls before either is awaited: the only ordering that catches an await between
    // reading the slot and claiming it.
    let downloads = 0;
    const service = new ParakeetVoiceService({
      // oxlint-disable-next-line require-await -- `fetch` is an async port; this fake answers from memory
      fetchImpl: async () => {
        downloads += 1;
        return new Response("nope", { status: 500 });
      },
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: workerOk,
    });
    const [first, second] = await Promise.allSettled([service.install(), service.install()]);
    expect(first?.status).toBe("fulfilled");
    expect(second?.status).toBe("rejected");
    if (second?.status === "rejected") {
      expect(second.reason).toBeInstanceOf(VoiceBusyError);
    }
    expect(downloads).toBeLessThanOrEqual(1);
  });

  it("reports a failed download as the reason it has no model", async () => {
    const service = new ParakeetVoiceService({
      // oxlint-disable-next-line require-await -- `fetch` is an async port; this fake answers from memory
      fetchImpl: async () => new Response("nope", { status: 500 }),
      modelDir: makeTempDir("inteligir-voice-"),
      runWorker: workerOk,
    });
    const started = await service.install();
    expect(started.state).toBe("downloading");
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
      onError: (message) => {
        errors.push(message);
      },
      onFinal: () => {},
      onPartial: () => {},
    });
    await vi.waitFor(() => {
      expect(errors).not.toHaveLength(0);
    });
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
      onError: () => {},
      onFinal: (text) => {
        finals.push(text);
      },
      onPartial: () => {},
    });
    await vi.waitFor(() => {
      expect(spawn.spawnCount()).toBe(1);
    });
    expect(spawn.latest()?.model.encoder).toContain(VOICE_MODEL.files.encoder);
    spawn.latest()?.callbacks.onFinal("streamed text");
    expect(finals).toEqual(["streamed text"]);
    await session.dispose();
  });

  it("a decode failure from a streaming worker is relayed and KEEPS the model", async () => {
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
      onError: (message) => {
        errors.push(message);
      },
      onFinal: () => {},
      onPartial: () => {},
    });
    await vi.waitFor(() => {
      expect(spawn.latest()).not.toBeNull();
    });
    spawn.latest()?.callbacks.onError("the runtime choked on this clip", false);
    await vi.waitFor(() => {
      expect(errors).toEqual(["the runtime choked on this clip"]);
    });
    expect(existsSync(resolveModelFiles(modelDir, VOICE_MODEL).encoder)).toBe(true);
    const kept = await service.status();
    expect(kept.state).toBe("ready");
  });

  it("nukes a model a streaming worker will not LOAD and drops to no-model with the reason", async () => {
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
      onError: (message) => {
        errors.push(message);
      },
      onFinal: () => {},
      onPartial: () => {},
    });
    await vi.waitFor(() => {
      expect(spawn.latest()).not.toBeNull();
    });
    spawn.latest()?.callbacks.onError("could not open the model", true);
    await vi.waitFor(() => {
      expect(errors).not.toHaveLength(0);
    });
    expect(existsSync(modelDirFor(modelDir, VOICE_MODEL))).toBe(false);
    expect(errors[0]).toMatch(/removed/u);
    const after = await service.status();
    expect(after.state).toBe("no-model");
    if (after.state === "no-model") {
      expect(after.lastError).toMatch(/removed/u);
    }
  });
});

describe("createScriptedVoiceService", () => {
  it("is ready with no model on disk", async () => {
    const service = createScriptedVoiceService();
    const status = await service.status();
    expect(status.state).toBe("ready");
  });

  it("streams scripted partials and a final over a session", () => {
    const service = createScriptedVoiceService();
    const partials: string[] = [];
    const finals: string[] = [];
    const session = service.createStreamSession({
      onError: () => {},
      onFinal: (text) => {
        finals.push(text);
      },
      onPartial: (text) => {
        partials.push(text);
      },
    });
    session.pushPcm(new ArrayBuffer(20));
    session.finalize();
    expect(partials).toEqual(["scripted dictation of 10 samples"]);
    expect(finals).toEqual(["scripted dictation of 10 samples"]);
  });
});
