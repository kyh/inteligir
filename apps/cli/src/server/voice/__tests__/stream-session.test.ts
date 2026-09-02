import { describe, expect, it } from "vitest";
import {
  ScriptedStreamSession,
  STREAM_MAX_SAMPLES,
  WorkerStreamSession,
  type StreamHandlers,
} from "../stream-session";
import type { VoiceStreamWorkerCallbacks, VoiceStreamWorkerHandle } from "../voice-worker-host";
import type { VoiceModelFiles } from "../worker-protocol";

const MODEL: VoiceModelFiles = {
  encoder: "/m/encoder.onnx",
  decoder: "/m/decoder.onnx",
  joiner: "/m/joiner.onnx",
  tokens: "/m/tokens.txt",
};

const pcm = (samples: number): ArrayBuffer => new ArrayBuffer(samples * 2);
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface FakeWorker {
  callbacks: VoiceStreamWorkerCallbacks;
  pushed: ArrayBuffer[];
  finalizeCount: number;
  disposeCount: number;
}

function makeSpawn() {
  const spawned: FakeWorker[] = [];
  const spawn = (
    _model: VoiceModelFiles,
    callbacks: VoiceStreamWorkerCallbacks,
  ): VoiceStreamWorkerHandle => {
    const worker: FakeWorker = { callbacks, pushed: [], finalizeCount: 0, disposeCount: 0 };
    spawned.push(worker);
    return {
      pushPcm: (buffer) => worker.pushed.push(buffer),
      finalize: () => {
        worker.finalizeCount += 1;
      },
      dispose: async () => {
        worker.disposeCount += 1;
      },
    };
  };
  return { spawn, spawned };
}

interface Recorder {
  handlers: StreamHandlers;
  partials: string[];
  finals: string[];
  errors: string[];
}

function recorder(): Recorder {
  const partials: string[] = [];
  const finals: string[] = [];
  const errors: string[] = [];
  return {
    partials,
    finals,
    errors,
    handlers: {
      onPartial: (text) => partials.push(text),
      onFinal: (text) => finals.push(text),
      onError: (message) => errors.push(message),
    },
  };
}

describe("WorkerStreamSession", () => {
  it("spawns ONE worker, flushes queued frames, finalizes, and tears down on the final", async () => {
    const { spawn, spawned } = makeSpawn();
    const rec = recorder();
    const session = new WorkerStreamSession({
      handlers: rec.handlers,
      prepare: async () => ({ ok: true, model: MODEL }),
      spawn,
      onModelUnusable: async () => "removed",
    });

    session.pushPcm(pcm(10));
    await tick();
    expect(spawned.length).toBe(1);
    const worker = spawned[0];
    if (worker === undefined) throw new Error("no worker");
    expect(worker.pushed.length).toBe(1);

    session.pushPcm(pcm(10));
    expect(worker.pushed.length).toBe(2);

    worker.callbacks.onPartial("hel");
    worker.callbacks.onPartial("hello");
    expect(rec.partials).toEqual(["hel", "hello"]);

    session.finalize();
    expect(worker.finalizeCount).toBe(1);
    worker.callbacks.onFinal("hello world");
    expect(rec.finals).toEqual(["hello world"]);

    await tick();
    expect(worker.disposeCount).toBe(1);

    session.pushPcm(pcm(10));
    session.finalize();
    await session.dispose();
    expect(worker.pushed.length).toBe(2);
    expect(worker.finalizeCount).toBe(1);
    expect(worker.disposeCount).toBe(1);
  });

  it("tears the worker down on cancel/disconnect, with no final and no late partials", async () => {
    const { spawn, spawned } = makeSpawn();
    const rec = recorder();
    const session = new WorkerStreamSession({
      handlers: rec.handlers,
      prepare: async () => ({ ok: true, model: MODEL }),
      spawn,
      onModelUnusable: async () => "removed",
    });
    await tick();
    const worker = spawned[0];
    if (worker === undefined) throw new Error("no worker");
    worker.callbacks.onPartial("partial");

    await session.dispose();
    expect(worker.disposeCount).toBe(1);
    expect(rec.finals).toEqual([]);

    worker.callbacks.onPartial("late");
    expect(rec.partials).toEqual(["partial"]);
  });

  it("does not leak a worker when disposed while prepare is still in flight", async () => {
    const { spawn, spawned } = makeSpawn();
    const rec = recorder();
    let release: (() => void) | undefined;
    const prepare = (): Promise<{ ok: true; model: VoiceModelFiles }> =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, model: MODEL });
      });
    const session = new WorkerStreamSession({
      handlers: rec.handlers,
      prepare,
      spawn,
      onModelUnusable: async () => "removed",
    });
    await session.dispose();
    release?.();
    await tick();
    expect(spawned.length).toBe(0);
    expect(rec.errors).toEqual([]);
  });

  it("nukes a model the worker reports unusable and tells the user it was removed", async () => {
    const { spawn, spawned } = makeSpawn();
    const rec = recorder();
    let nuked = 0;
    const session = new WorkerStreamSession({
      handlers: rec.handlers,
      prepare: async () => ({ ok: true, model: MODEL }),
      spawn,
      onModelUnusable: async () => {
        nuked += 1;
        return "The model could not be loaded and was removed.";
      },
    });
    await tick();
    const worker = spawned[0];
    if (worker === undefined) throw new Error("no worker");
    worker.callbacks.onError("failed to open the model", true);
    await tick();
    expect(nuked).toBe(1);
    expect(rec.errors).toEqual(["The model could not be loaded and was removed."]);
    expect(worker.disposeCount).toBe(1);
    await session.dispose();
  });

  it("passes a decode error straight through and keeps the model", async () => {
    const { spawn, spawned } = makeSpawn();
    const rec = recorder();
    let nuked = 0;
    const session = new WorkerStreamSession({
      handlers: rec.handlers,
      prepare: async () => ({ ok: true, model: MODEL }),
      spawn,
      onModelUnusable: async () => {
        nuked += 1;
        return "removed";
      },
    });
    await tick();
    const worker = spawned[0];
    if (worker === undefined) throw new Error("no worker");
    worker.callbacks.onError("the runtime choked on this clip", false);
    await tick();
    expect(nuked).toBe(0);
    expect(rec.errors).toEqual(["the runtime choked on this clip"]);
    await session.dispose();
  });

  it("reports a prepare refusal without spawning a worker", async () => {
    const { spawn, spawned } = makeSpawn();
    const rec = recorder();
    const session = new WorkerStreamSession({
      handlers: rec.handlers,
      prepare: async () => ({ ok: false, reason: "needs the model" }),
      spawn,
      onModelUnusable: async () => "removed",
    });
    await tick();
    expect(spawned.length).toBe(0);
    expect(rec.errors).toEqual(["needs the model"]);
    await session.dispose();
  });

  it("bounds the audio it forwards over a long hold", async () => {
    const { spawn, spawned } = makeSpawn();
    const rec = recorder();
    const session = new WorkerStreamSession({
      handlers: rec.handlers,
      prepare: async () => ({ ok: true, model: MODEL }),
      spawn,
      onModelUnusable: async () => "removed",
    });
    session.pushPcm(pcm(STREAM_MAX_SAMPLES));
    session.pushPcm(pcm(1000));
    await tick();
    const worker = spawned[0];
    if (worker === undefined) throw new Error("no worker");
    const forwarded = worker.pushed.reduce((total, buffer) => total + buffer.byteLength / 2, 0);
    expect(forwarded).toBeLessThanOrEqual(STREAM_MAX_SAMPLES);
    expect(worker.pushed.length).toBe(1);
  });
});

describe("ScriptedStreamSession", () => {
  it("counts samples across frames and names them in partials and the final", () => {
    const rec = recorder();
    const session = new ScriptedStreamSession(rec.handlers);
    session.pushPcm(pcm(10));
    session.pushPcm(pcm(20));
    expect(rec.partials).toEqual([
      "scripted dictation of 10 samples",
      "scripted dictation of 30 samples",
    ]);
    session.finalize();
    expect(rec.finals).toEqual(["scripted dictation of 30 samples"]);
  });

  it("goes quiet after dispose", async () => {
    const rec = recorder();
    const session = new ScriptedStreamSession(rec.handlers);
    await session.dispose();
    session.pushPcm(pcm(10));
    session.finalize();
    expect(rec.partials).toEqual([]);
    expect(rec.finals).toEqual([]);
  });
});
