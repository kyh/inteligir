// ---------------------------------------------------------------------------
// Agent store submission failures — a rejected sendAgentCommand must surface
// in the chat instead of leaving the optimistic user bubble looking sent
// while the message silently never reached the agent.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

const helpers = vi.hoisted(
  (): {
    bridgeMock: {
      sendAgentCommand: ReturnType<typeof vi.fn>;
      onAgentEvent: ReturnType<typeof vi.fn>;
      onAppState: ReturnType<typeof vi.fn>;
      onSetupProgress: ReturnType<typeof vi.fn>;
      getAppState: ReturnType<typeof vi.fn>;
      getAgentHistory: ReturnType<typeof vi.fn>;
      transition: ReturnType<typeof vi.fn>;
      isTtsAvailable: ReturnType<typeof vi.fn>;
      onVoiceModelState: ReturnType<typeof vi.fn>;
    };
  } => ({
    bridgeMock: {
      sendAgentCommand: vi.fn(),
      onAgentEvent: vi.fn(() => () => {}),
      onAppState: vi.fn(() => () => {}),
      onSetupProgress: vi.fn(() => () => {}),
      getAppState: vi.fn(),
      getAgentHistory: vi.fn(),
      transition: vi.fn(),
      isTtsAvailable: vi.fn(() => Promise.resolve(false)),
      onVoiceModelState: vi.fn(() => () => {}),
    },
  }),
);

vi.mock("@renderer/lib/bridge", () => ({
  getBridge: () => helpers.bridgeMock,
}));

vi.mock("@renderer/voice/voice-pipeline", () => ({
  // Never constructed here (isTtsAvailable resolves false), but the module
  // must export the symbol voice-store imports.
  VoicePipeline: vi.fn(),
}));

const { useAgentStore } = await import("@renderer/stores/agent-store");

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({
    messages: [],
    appState: { phase: "ready", agent: "idle" },
    queuedFollowUp: [],
    queuedSteering: [],
  });
});

describe("agent-store send", () => {
  it("appends the user message and nothing else on success", async () => {
    helpers.bridgeMock.sendAgentCommand.mockResolvedValue(undefined);

    useAgentStore.getState().send("hello");
    await flushMicrotasks();

    const messages = useAgentStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    // The sent text carries the date-grounding context prefix (stripped from
    // the displayed bubble); assert the user's words survive inside it.
    expect(helpers.bridgeMock.sendAgentCommand).toHaveBeenCalledWith({
      type: "user_message",
      text: expect.stringContaining("hello"),
      images: undefined,
    });
  });

  it("surfaces a rejected submission as an error bubble in the chat", async () => {
    helpers.bridgeMock.sendAgentCommand.mockRejectedValue(new Error("Agent unavailable"));

    useAgentStore.getState().send("hello");
    await flushMicrotasks();

    const messages = useAgentStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    const failure = messages[1];
    expect(failure?.role).toBe("assistant");
    expect(failure?.metadata?.errorKind).toBe("unknown");
    const part = failure?.parts[0];
    expect(part?.type === "text" ? part.text : "").toContain("Agent unavailable");
  });
});
