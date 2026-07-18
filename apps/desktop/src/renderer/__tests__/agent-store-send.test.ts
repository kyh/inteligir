// ---------------------------------------------------------------------------
// Agent store submission failures — a rejected sendAgentCommand must surface
// in the chat instead of leaving the optimistic user bubble looking sent
// while the message silently never reached the agent — plus the note-context
// privacy contract: the open note's PATH only rides a turn when the host's
// LIVE-disk probe says "public" (an external `private: true` flip lands on
// disk before the renderer buffer hears about it).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyChatLog } from "@repo/features/chat-log";
import {
  registerOpenNoteFlush,
  registerOpenNotePath,
  registerOpenNotePrivacy,
} from "@renderer/workspace/open-note-flush";

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
      probeNotePrivacy: ReturnType<typeof vi.fn>;
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
      probeNotePrivacy: vi.fn(() => Promise.resolve("public")),
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
    log: emptyChatLog,
    chatMeta: new Map(),
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

// Simulate an open note whose RENDERER BUFFER reads public — the disk
// verdict comes from the mocked host probe, which is the point: an
// external flip to private lands on disk first.
function openBufferPublicNote(path: string): void {
  registerOpenNoteFlush(() => Promise.resolve(true));
  registerOpenNotePath(() => path);
  registerOpenNotePrivacy(() => false);
}

describe("agent-store send — note-context privacy (live disk probe)", () => {
  afterEach(() => {
    registerOpenNoteFlush(null);
    registerOpenNotePath(null);
    registerOpenNotePrivacy(null);
  });

  it("attaches the open note's path when disk agrees it is public", async () => {
    helpers.bridgeMock.sendAgentCommand.mockResolvedValue(undefined);
    helpers.bridgeMock.probeNotePrivacy.mockResolvedValue("public");
    openBufferPublicNote("notes/plan.md");

    await useAgentStore.getState().send("hello");

    expect(helpers.bridgeMock.probeNotePrivacy).toHaveBeenCalledWith({ path: "notes/plan.md" });
    expect(helpers.bridgeMock.sendAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("./vault/notes/plan.md") }),
    );
  });

  it("suppresses the path when the note flipped private ON DISK behind a stale public buffer", async () => {
    // The external-flip window: sync pull / background-agent write landed
    // `private: true` on disk; the open-note watcher hasn't reloaded yet, so
    // the buffer (and openNoteIsPrivate) still reads public. The host probe
    // must win — not even the PATH may ride the turn.
    helpers.bridgeMock.sendAgentCommand.mockResolvedValue(undefined);
    helpers.bridgeMock.probeNotePrivacy.mockResolvedValue("private");
    openBufferPublicNote("notes/secret.md");

    await useAgentStore.getState().send("hello");

    const sent: unknown = helpers.bridgeMock.sendAgentCommand.mock.calls[0]?.[0];
    expect(JSON.stringify(sent)).not.toContain("notes/secret.md");
  });

  it("suppresses the path when the disk probe fails (fail-closed)", async () => {
    helpers.bridgeMock.sendAgentCommand.mockResolvedValue(undefined);
    helpers.bridgeMock.probeNotePrivacy.mockRejectedValue(new Error("host unavailable"));
    openBufferPublicNote("notes/anything.md");

    await useAgentStore.getState().send("hello");

    const sent: unknown = helpers.bridgeMock.sendAgentCommand.mock.calls[0]?.[0];
    expect(JSON.stringify(sent)).not.toContain("notes/anything.md");
  });
});
