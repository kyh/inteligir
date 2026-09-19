import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { ScriptedStreamSession } from "../scripted-stream-session";
import { STREAM_MAX_SAMPLES, WorkerStreamSession } from "../stream-session";
import type { StreamHandlers } from "../stream-session";
import type { VoiceStreamWorkerCallbacks, VoiceStreamWorkerHandle } from "../voice-worker-host";
import type { VoiceModelFiles } from "../worker-protocol";

const MODEL: VoiceModelFiles = {
  decoder: "/m/decoder.onnx",
  encoder: "/m/encoder.onnx",
  joiner: "/m/joiner.onnx",
  tokens: "/m/tokens.txt",
};

const pcm = (samples: number): ArrayBuffer => new ArrayBuffer(samples * 2);
const tick = async (): Promise<void> => {
  await delay(0);
};

interface FakeWorker {
  callbacks: VoiceStreamWorkerCallbacks;
  pushed: ArrayBuffer[];
  finalizeCount: number;
  disposeCount: number;
}

const makeSpawn = () => {
  const spawned: FakeWorker[] = [];
  const spawn = (
    _model: VoiceModelFiles,
    callbacks: VoiceStreamWorkerCallbacks,
  ): VoiceStreamWorkerHandle => {
    const worker: FakeWorker = { callbacks, disposeCount: 0, finalizeCount: 0, pushed: [] };
    spawned.push(worker);
    return {
      dispose: () => {
        worker.disposeCount += 1;
      },
      finalize: () => {
        worker.finalizeCount += 1;
      },
      pushPcm: (buffer) => {
        worker.pushed.push(buffer);
      },
    };
  };
  return { spawn, spawned };
};

interface Recorder {
  handlers: StreamHandlers;
  partials: string[];
  finals: string[];
  errors: string[];
}

const recorder = (): Recorder => {
  const partials: string[] = [];
  const finals: string[] = [];
  const errors: string[] = [];
  return {
    errors,
    finals,
    handlers: {
      onError: (message) => {
        errors.push(message);
      },
      onFinal: (text) => {
        finals.push(text);
      },
      onPartial: (text) => {
        partials.push(text);
      },
    },
    partials,
  };
};

describe("WorkerStreamSession", () => {
  it("spawns ONE worker, flushes queued frames, finalizes, and tears down on the final", async () => {
    const { spawn, spawned } = makeSpawn();
    const rec = recorder();
    const session = new WorkerStreamSession({
      handlers: rec.handlers,
      onModelUnusable: () => "removed",
      prepare: () => ({ model: MODEL, ok: true }),
      spawn,
    });

    session.pushPcm(pcm(10));
    await tick();
    expect(spawned.length).toBe(1);
    const [worker] = spawned;
    if (worker === undefined) {
      throw new Error("no worker");
    }
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
      onModelUnusable: () => "removed",
      prepare: () => ({ model: MODEL, ok: true }),
      spawn,
    });
    await tick();
    const [worker] = spawned;
    if (worker === undefined) {
      throw new Error("no worker");
    }
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
    const pending = Promise.withResolvers<{ ok: true; model: VoiceModelFiles }>();
    const prepare = async (): Promise<{ ok: true; model: VoiceModelFiles }> =>
      await pending.promise;
    const session = new WorkerStreamSession({
      handlers: rec.handlers,
      onModelUnusable: () => "removed",
      prepare,
      spawn,
    });
    await session.dispose();
    pending.resolve({ model: MODEL, ok: true });
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
      onModelUnusable: () => {
        nuked += 1;
        return "The model could not be loaded and was removed.";
      },
      prepare: () => ({ model: MODEL, ok: true }),
      spawn,
    });
    await tick();
    const [worker] = spawned;
    if (worker === undefined) {
      throw new Error("no worker");
    }
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
      onModelUnusable: () => {
        nuked += 1;
        return "removed";
      },
      prepare: () => ({ model: MODEL, ok: true }),
      spawn,
    });
    await tick();
    const [worker] = spawned;
    if (worker === undefined) {
      throw new Error("no worker");
    }
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
      onModelUnusable: () => "removed",
      prepare: () => ({ ok: false, reason: "needs the model" }),
      spawn,
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
      onModelUnusable: () => "removed",
      prepare: () => ({ model: MODEL, ok: true }),
      spawn,
    });
    session.pushPcm(pcm(STREAM_MAX_SAMPLES));
    session.pushPcm(pcm(1000));
    await tick();
    const [worker] = spawned;
    if (worker === undefined) {
      throw new Error("no worker");
    }
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
