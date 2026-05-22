import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs before vi.mock factories, so the mocks below can reach
// `helpers` to share state with the test code.
const helpers = vi.hoisted(() => ({
  pipelineInstances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    config: unknown;
  }>,
  bridgeMock: {
    getVoiceConfig: vi.fn<() => Promise<unknown>>(),
    getVoiceModelStatus: vi.fn<() => Promise<"ready" | "missing">>(),
    downloadVoiceModel: vi.fn<() => Promise<{ ok: boolean; error?: string }>>(),
    onVoiceModelState: vi.fn(() => () => {}),
    sendAgentCommand: vi.fn(),
  },
}));

vi.mock("@/renderer/lib/bridge", () => ({
  getBridge: () => helpers.bridgeMock,
}));

vi.mock("@/renderer/voice/voice-pipeline", () => ({
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

vi.mock("@/renderer/stores/agent-store", () => ({
  useAgentStore: { getState: () => ({ addUserMessage: vi.fn() }) },
}));

const { useVoiceStore } = await import("@/renderer/stores/voice-store");

async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("voice-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.pipelineInstances.length = 0;
    useVoiceStore.getState().reset();
    helpers.bridgeMock.getVoiceConfig.mockResolvedValue({
      elevenlabsApiKey: "k",
      elevenlabsVoiceId: "v",
    });
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

    it("does not forward a tail final to the agent if the session ended", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("ready");
      useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();
      // Simulate teardown between disconnect and the tail final's arrival.
      useVoiceStore.getState().reset();

      const inst = helpers.pipelineInstances[0];
      const callbacks = inst?.config as
        | { onTranscriptFinal: (text: string) => void }
        | undefined;
      callbacks?.onTranscriptFinal("late tail words");

      expect(helpers.bridgeMock.sendAgentCommand).not.toHaveBeenCalled();
    });
  });

  describe("toggleVoice — race conditions", () => {
    it("does not connect if the store is torn down mid-getStatus", async () => {
      let resolveStatus: (v: "ready" | "missing") => void = () => {};
      helpers.bridgeMock.getVoiceModelStatus.mockReturnValue(
        new Promise<"ready" | "missing">((r) => {
          resolveStatus = r;
        }),
      );

      const cleanup = useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      cleanup();
      resolveStatus("ready");
      await flushMicrotasks();

      expect(helpers.pipelineInstances[0]?.connect).not.toHaveBeenCalled();
    });

    it("does not connect if the store remounts mid-download", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("missing");
      let resolveDownload: (v: { ok: boolean }) => void = () => {};
      helpers.bridgeMock.downloadVoiceModel.mockReturnValue(
        new Promise<{ ok: boolean }>((r) => {
          resolveDownload = r;
        }),
      );

      const cleanup1 = useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      cleanup1();
      useVoiceStore.getState().init();
      await flushMicrotasks();

      resolveDownload({ ok: true });
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
      let resolveDownload: (v: { ok: boolean }) => void = () => {};
      helpers.bridgeMock.downloadVoiceModel.mockReturnValue(
        new Promise<{ ok: boolean }>((r) => {
          resolveDownload = r;
        }),
      );

      useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      useVoiceStore.getState().reset();
      resolveDownload({ ok: true });
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
