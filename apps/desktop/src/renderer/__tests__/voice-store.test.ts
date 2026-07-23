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
      onVoiceModelState: ReturnType<typeof vi.fn<() => () => void>>;
      sendAgentCommand: ReturnType<typeof vi.fn>;
    };
  } => ({
    pipelineInstances: [],
    bridgeMock: {
      isTtsAvailable: vi.fn<() => Promise<boolean>>(),
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

vi.mock("@renderer/lib/bridge", () => ({
  getBridge: () => helpers.bridgeMock,
}));

vi.mock("@renderer/voice/voice-pipeline", () => ({
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

const { useVoiceStore, onUserTranscript } = await import("@renderer/stores/voice-store");

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
    it("connects straight away (the model download is host-driven)", async () => {
      useVoiceStore.getState().init();
      await flushMicrotasks();

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      expect(helpers.pipelineInstances).toHaveLength(1);
      expect(helpers.pipelineInstances[0]?.connect).toHaveBeenCalledOnce();
      expect(useVoiceStore.getState().state.kind).toBe("listening");
    });

    it("surfaces an error state when connect fails (e.g. model still missing)", async () => {
      useVoiceStore.getState().init();
      await flushMicrotasks();
      helpers.pipelineInstances[0]?.connect.mockRejectedValue(
        new Error("Parakeet model not installed."),
      );

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      const state = useVoiceStore.getState().state;
      expect(state.kind).toBe("error");
      if (state.kind === "error") expect(state.message).toBe("Parakeet model not installed.");
    });

    it("does not fire onUserTranscript for a tail final after teardown", async () => {
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
    it("drops the orphaned mic when torn down mid-connect", async () => {
      const connect = createDeferred<void>();
      const cleanup = useVoiceStore.getState().init();
      await flushMicrotasks();
      const inst = helpers.pipelineInstances[0];
      inst?.connect.mockReturnValue(connect.promise);

      useVoiceStore.getState().toggleVoice();
      cleanup();
      connect.resolve(undefined);
      await flushMicrotasks();

      // Connect resolved after the generation bump: the captured session is
      // disconnected (mic released) and the machine never reaches listening.
      expect(inst?.disconnect).toHaveBeenCalled();
      expect(useVoiceStore.getState().state.kind).toBe("idle");
    });

    it("does not go listening if the store remounts mid-connect", async () => {
      const connect = createDeferred<void>();
      const cleanup1 = useVoiceStore.getState().init();
      await flushMicrotasks();
      helpers.pipelineInstances[0]?.connect.mockReturnValue(connect.promise);

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      cleanup1();
      useVoiceStore.getState().init();
      await flushMicrotasks();

      connect.resolve(undefined);
      await flushMicrotasks();

      // Generation bump on the cleanup means the stale flow bails: the
      // original session is dropped and the replacement never connected.
      expect(helpers.pipelineInstances).toHaveLength(2);
      expect(helpers.pipelineInstances[0]?.disconnect).toHaveBeenCalled();
      expect(helpers.pipelineInstances[1]?.connect).not.toHaveBeenCalled();
      expect(useVoiceStore.getState().state.kind).toBe("idle");
    });

    it("reset() prevents an in-flight connect from reaching listening", async () => {
      const connect = createDeferred<void>();
      useVoiceStore.getState().init();
      await flushMicrotasks();
      helpers.pipelineInstances[0]?.connect.mockReturnValue(connect.promise);

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      useVoiceStore.getState().reset();
      connect.resolve(undefined);
      await flushMicrotasks();

      expect(useVoiceStore.getState().state.kind).toBe("idle");
    });

    it("stops state writes after teardown when connect rejects", async () => {
      const cleanup = useVoiceStore.getState().init();
      await flushMicrotasks();
      helpers.pipelineInstances[0]?.connect.mockRejectedValue(new Error("mic denied"));

      useVoiceStore.getState().toggleVoice();
      cleanup();
      await flushMicrotasks();

      expect(useVoiceStore.getState().state.kind).toBe("idle");
    });
  });

  describe("init cleanup", () => {
    it("resets transient state so a remount doesn't inherit connecting", async () => {
      const cleanup = useVoiceStore.getState().init();
      await flushMicrotasks();
      helpers.pipelineInstances[0]?.connect.mockReturnValue(new Promise<never>(() => {}));

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();
      expect(useVoiceStore.getState().state.kind).toBe("connecting");

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
