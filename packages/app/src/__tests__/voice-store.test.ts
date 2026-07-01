import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PipelineInstance = {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  config: unknown;
};

type TranscriptFinalConfig = {
  onTranscriptFinal: (text: string) => void;
};

// vi.hoisted runs before vi.mock factories, so the mocks below can reach
// `helpers` to share state with the test code.
const helpers = vi.hoisted(
  (): {
    pipelineInstances: PipelineInstance[];
    bridgeMock: {
      isTtsAvailable: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
      getVoiceModelStatus: ReturnType<typeof vi.fn<() => Promise<"ready" | "missing">>>;
      downloadVoiceModel: ReturnType<typeof vi.fn<() => Promise<{ ok: boolean; error?: string }>>>;
      onVoiceModelState: ReturnType<typeof vi.fn<() => () => void>>;
      sendAgentCommand: ReturnType<typeof vi.fn>;
    };
  } => ({
    pipelineInstances: [],
    bridgeMock: {
      isTtsAvailable: vi.fn<() => Promise<boolean>>(),
      getVoiceModelStatus: vi.fn<() => Promise<"ready" | "missing">>(),
      downloadVoiceModel: vi.fn<() => Promise<{ ok: boolean; error?: string }>>(),
      onVoiceModelState: vi.fn(() => () => {}),
      sendAgentCommand: vi.fn(),
    },
  }),
);

function hasTranscriptFinalConfig(config: unknown): config is TranscriptFinalConfig {
  return (
    typeof config === "object" &&
    config !== null &&
    "onTranscriptFinal" in config &&
    typeof config.onTranscriptFinal === "function"
  );
}

vi.mock("@repo/app/lib/bridge", () => ({
  getBridge: () => helpers.bridgeMock,
}));

vi.mock("@repo/app/voice/voice-pipeline", () => ({
  VoicePipeline: class {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
      helpers.pipelineInstances.push(this);
    }
  },
}));

const { useVoiceStore, onUserTranscript } = await import("@repo/app/stores/voice-store");

async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

function createDeferred<T>() {
  let resolveValue: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolveValue?.(value);
    },
  };
}

describe("voice-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.pipelineInstances.length = 0;
    useVoiceStore.getState().reset();
    helpers.bridgeMock.isTtsAvailable.mockResolvedValue(true);
  });

  afterEach(() => {
    useVoiceStore.getState().reset();
  });

  describe("toggleVoice — happy path", () => {
    it("downloads-then-connects when model is ready", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("ready");
      useVoiceStore.getState().init();
      await flushMicrotasks();

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      expect(helpers.pipelineInstances).toHaveLength(1);
      expect(helpers.pipelineInstances[0]?.connect).toHaveBeenCalledOnce();
      expect(helpers.bridgeMock.downloadVoiceModel).not.toHaveBeenCalled();
      expect(useVoiceStore.getState().state.kind).toBe("listening");
    });

    it("downloads then connects when model is missing", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("missing");
      helpers.bridgeMock.downloadVoiceModel.mockResolvedValue({ ok: true });
      useVoiceStore.getState().init();
      await flushMicrotasks();

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      expect(helpers.bridgeMock.downloadVoiceModel).toHaveBeenCalledOnce();
      expect(helpers.pipelineInstances[0]?.connect).toHaveBeenCalledOnce();
      expect(useVoiceStore.getState().state.kind).toBe("listening");
    });

    it("surfaces an error state when the download fails", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("missing");
      helpers.bridgeMock.downloadVoiceModel.mockResolvedValue({ ok: false, error: "boom" });
      useVoiceStore.getState().init();
      await flushMicrotasks();

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      const state = useVoiceStore.getState().state;
      expect(state.kind).toBe("error");
      if (state.kind === "error") expect(state.message).toBe("boom");
      expect(helpers.pipelineInstances[0]?.connect).not.toHaveBeenCalled();
    });

    it("does not fire onUserTranscript for a tail final after teardown", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("ready");
      const listener = vi.fn();
      const unsub = onUserTranscript(listener);
      try {
        useVoiceStore.getState().init();
        await flushMicrotasks();
        useVoiceStore.getState().toggleVoice();
        await flushMicrotasks();
        // Simulate teardown between disconnect and the tail final's arrival.
        useVoiceStore.getState().reset();

        const inst = helpers.pipelineInstances[0];
        if (hasTranscriptFinalConfig(inst?.config)) {
          inst.config.onTranscriptFinal("late tail words");
        }

        expect(listener).not.toHaveBeenCalled();
      } finally {
        unsub();
      }
    });
  });

  describe("toggleVoice — race conditions", () => {
    it("does not connect if the store is torn down mid-getStatus", async () => {
      const status = createDeferred<"ready" | "missing">();
      helpers.bridgeMock.getVoiceModelStatus.mockReturnValue(status.promise);

      const cleanup = useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      cleanup();
      status.resolve("ready");
      await flushMicrotasks();

      expect(helpers.pipelineInstances[0]?.connect).not.toHaveBeenCalled();
    });

    it("does not connect if the store remounts mid-download", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("missing");
      const download = createDeferred<{ ok: boolean }>();
      helpers.bridgeMock.downloadVoiceModel.mockReturnValue(download.promise);

      const cleanup1 = useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      cleanup1();
      useVoiceStore.getState().init();
      await flushMicrotasks();

      download.resolve({ ok: true });
      await flushMicrotasks();

      // Generation bump on the cleanup means the stale flow's "model_download_ok"
      // is dispatched after the bump and the runConnect function bails before
      // calling pipeline.connect. Neither the original nor the replacement
      // should connect.
      expect(helpers.pipelineInstances).toHaveLength(2);
      expect(helpers.pipelineInstances[0]?.connect).not.toHaveBeenCalled();
      expect(helpers.pipelineInstances[1]?.connect).not.toHaveBeenCalled();
    });

    it("reset() prevents an in-flight download from connecting", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("missing");
      const download = createDeferred<{ ok: boolean }>();
      helpers.bridgeMock.downloadVoiceModel.mockReturnValue(download.promise);

      useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      useVoiceStore.getState().reset();
      download.resolve({ ok: true });
      await flushMicrotasks();

      expect(helpers.pipelineInstances[0]?.connect).not.toHaveBeenCalled();
      expect(useVoiceStore.getState().state.kind).toBe("idle");
    });

    it("stops state writes after teardown when getStatus rejects", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockRejectedValue(new Error("ipc dropped"));

      const cleanup = useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      cleanup();
      await flushMicrotasks();

      expect(useVoiceStore.getState().state.kind).toBe("idle");
    });
  });

  describe("init cleanup", () => {
    it("resets transient state so a remount doesn't inherit downloading_model", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("missing");
      helpers.bridgeMock.downloadVoiceModel.mockReturnValue(new Promise<never>(() => {}));

      const cleanup = useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();
      expect(useVoiceStore.getState().state.kind).toBe("downloading_model");

      cleanup();
      expect(useVoiceStore.getState().state.kind).toBe("idle");
    });
  });

  describe("ttsConfigured", () => {
    it("is true after init when TTS is available", async () => {
      helpers.bridgeMock.isTtsAvailable.mockResolvedValue(true);
      useVoiceStore.getState().init();
      await flushMicrotasks();

      expect(useVoiceStore.getState().ttsConfigured).toBe(true);
      expect(helpers.pipelineInstances).toHaveLength(1);
    });

    it("is false when TTS is unconfigured, and the mic toggle stays a no-op", async () => {
      helpers.bridgeMock.isTtsAvailable.mockResolvedValue(false);
      useVoiceStore.getState().init();
      await flushMicrotasks();

      expect(useVoiceStore.getState().ttsConfigured).toBe(false);
      // No pipeline was built, so toggling must not move the machine — the
      // dock renders the mic disabled with a pointer to Settings instead.
      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();
      expect(useVoiceStore.getState().state.kind).toBe("idle");
      expect(helpers.pipelineInstances).toHaveLength(0);
    });

    it("is false when the availability probe rejects", async () => {
      helpers.bridgeMock.isTtsAvailable.mockRejectedValue(new Error("ipc dropped"));
      useVoiceStore.getState().init();
      await flushMicrotasks();

      expect(useVoiceStore.getState().ttsConfigured).toBe(false);
      expect(helpers.pipelineInstances).toHaveLength(0);
    });
  });

  describe("model-state listener cleanup", () => {
    it("init cleanup unsubscribes the onVoiceModelState listener", async () => {
      const unsub = vi.fn();
      helpers.bridgeMock.onVoiceModelState.mockReturnValue(unsub);

      const cleanup = useVoiceStore.getState().init();
      await flushMicrotasks();
      cleanup();

      expect(unsub).toHaveBeenCalledOnce();
    });

    it("reset() also unsubscribes the listener", async () => {
      const unsub = vi.fn();
      helpers.bridgeMock.onVoiceModelState.mockReturnValue(unsub);

      useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().reset();

      expect(unsub).toHaveBeenCalledOnce();
    });
  });
});
