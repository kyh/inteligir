// ---------------------------------------------------------------------------
// Agent store submission failures — a rejected sendAgentCommand must surface
// in the chat instead of leaving the optimistic user bubble looking sent
// while the message silently never reached the agent — plus the note-context
// privacy contract: the open note's PATH only rides a turn when the host's
// LIVE-disk probe says "public" (an external `private: true` flip lands on
// disk before the client buffer hears about it).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyChatLog } from "@repo/bridge/chat-log";
import {
  registerOpenNoteFlush,
  registerOpenNotePath,
  registerOpenNotePrivacy,
} from "@repo/editor/note/open-note-flush";

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
    },
  }),
);

vi.mock("@repo/bridge/client", () => ({
  getBridge: () => helpers.bridgeMock,
}));

vi.mock("@repo/workspace/voice/voice-pipeline", () => ({
  // Never constructed here (isTtsAvailable resolves false), but the module
  // must export the symbol voice-store imports.
  VoicePipeline: vi.fn(),
}));

const { useAgentStore } = await import("@repo/workspace/stores/agent-store");

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

    void useAgentStore.getState().send("hello");
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

    void useAgentStore.getState().send("hello");
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
/** Simulate an open note the buffer reads as `private: true` or not. The
 * buffer is the ONLY gate — the host models no note privacy — so this is the
 * whole input to the context-hint decision. */
function openNote(path: string, isPrivate: boolean): void {
  registerOpenNoteFlush(() => Promise.resolve(true));
  registerOpenNotePath(() => path);
  registerOpenNotePrivacy(() => isPrivate);
}

describe("agent-store send — the open-note context hint", () => {
  afterEach(() => {
    registerOpenNoteFlush(null);
    registerOpenNotePath(null);
    registerOpenNotePrivacy(null);
  });

  it("attaches the open note's path", async () => {
    helpers.bridgeMock.sendAgentCommand.mockResolvedValue(undefined);
    openNote("notes/plan.md", false);

    await useAgentStore.getState().send("hello");

    expect(helpers.bridgeMock.sendAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("./vault/notes/plan.md") }),
    );
  });

  it("suppresses the path when the buffer reads private — not even the PATH rides the turn", async () => {
    helpers.bridgeMock.sendAgentCommand.mockResolvedValue(undefined);
    openNote("notes/secret.md", true);

    await useAgentStore.getState().send("hello");

    const sent: unknown = helpers.bridgeMock.sendAgentCommand.mock.calls[0]?.[0];
    expect(JSON.stringify(sent)).not.toContain("notes/secret.md");
  });

  it("suppresses the path when the flush did not land", async () => {
    // A failed save would point the agent at bytes that are not what the user
    // is looking at.
    helpers.bridgeMock.sendAgentCommand.mockResolvedValue(undefined);
    registerOpenNoteFlush(() => Promise.resolve(false));
    registerOpenNotePath(() => "notes/unsaved.md");
    registerOpenNotePrivacy(() => false);

    await useAgentStore.getState().send("hello");

    const sent: unknown = helpers.bridgeMock.sendAgentCommand.mock.calls[0]?.[0];
    expect(JSON.stringify(sent)).not.toContain("notes/unsaved.md");
  });
});
