import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs before vi.mock factories, so the mocks below can reach
// `helpers` to share state with the test code.
const helpers = vi.hoisted(() => ({
  pipelineInstances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
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
    disconnect = vi.fn();
    on = vi.fn();
    constructor() {
      helpers.pipelineInstances.push(this);
    }
  },
}));

vi.mock("@/renderer/stores/agent-store", () => ({
  useAgentStore: { getState: () => ({ addUserMessage: vi.fn() }) },
}));

const { useVoiceStore } = await import("@/renderer/stores/voice-store");

function resetStore() {
  useVoiceStore.setState({
    sessionState: "inactive",
    currentTranscript: "",
    error: null,
    modelState: null,
  });
}

async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("voice-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.pipelineInstances.length = 0;
    resetStore();
    helpers.bridgeMock.getVoiceConfig.mockResolvedValue({
      elevenlabsApiKey: "k",
      elevenlabsVoiceId: "v",
    });
  });

  afterEach(() => {
    useVoiceStore.getState().reset();
  });

  describe("toggleVoice — happy path", () => {
    it("connects immediately when model is ready", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("ready");
      useVoiceStore.getState().init();
      await flushMicrotasks();

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      expect(helpers.pipelineInstances).toHaveLength(1);
      expect(helpers.pipelineInstances[0]?.connect).toHaveBeenCalledOnce();
      expect(helpers.bridgeMock.downloadVoiceModel).not.toHaveBeenCalled();
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
    });

    it("surfaces an error state when the download fails", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockResolvedValue("missing");
      helpers.bridgeMock.downloadVoiceModel.mockResolvedValue({ ok: false, error: "boom" });
      useVoiceStore.getState().init();
      await flushMicrotasks();

      useVoiceStore.getState().toggleVoice();
      await flushMicrotasks();

      expect(useVoiceStore.getState().sessionState).toBe("error");
      expect(useVoiceStore.getState().error).toBe("boom");
      expect(helpers.pipelineInstances[0]?.connect).not.toHaveBeenCalled();
    });
  });

  describe("toggleVoice — race conditions", () => {
    it("does not connect if the pipeline is torn down mid-getStatus", async () => {
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

    it("does not connect if the pipeline is swapped mid-download (identity guard)", async () => {
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

      expect(helpers.pipelineInstances).toHaveLength(2);
      // Neither the original nor the replacement should auto-connect from the
      // stale ensureModelThenConnect call.
      expect(helpers.pipelineInstances[0]?.connect).not.toHaveBeenCalled();
      expect(helpers.pipelineInstances[1]?.connect).not.toHaveBeenCalled();
    });

    it("reset() prevents an in-flight download from connecting after dismissal", async () => {
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
    });

    it("stops state writes from the catch block after teardown", async () => {
      helpers.bridgeMock.getVoiceModelStatus.mockRejectedValue(new Error("ipc dropped"));

      const cleanup = useVoiceStore.getState().init();
      await flushMicrotasks();
      useVoiceStore.getState().toggleVoice();
      cleanup();
      await flushMicrotasks();

      expect(useVoiceStore.getState().sessionState).toBe("inactive");
      expect(useVoiceStore.getState().error).toBeNull();
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
      expect(useVoiceStore.getState().sessionState).toBe("downloading_model");

      cleanup();
      expect(useVoiceStore.getState().sessionState).toBe("inactive");
      expect(useVoiceStore.getState().modelState).toBeNull();
    });
  });
});
