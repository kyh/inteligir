// ---------------------------------------------------------------------------
// The voice ↔ chat wiring (renderer/voice/narration.ts). Both directions used
// to live inside stores/agent-store.ts with no coverage; moving them out of the
// core chat store is only safe if the behaviour is pinned, so it is pinned here.
//
// narration.ts is tested in ISOLATION: its two seams — the chat store's
// `onAssistantStream` / `send`, and the voice store — are faked, so this drives
// the wiring's own decisions (narrate only while listening, reset always,
// serialize transcripts) without booting a Bridge.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantStreamEvent } from "@renderer/stores/agent-store";

const send = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
const speakText = vi.fn<(text: string) => void>();
const flushSpeech = vi.fn<() => void>();
const reset = vi.fn<() => void>();

let voiceState: { kind: string } = { kind: "idle" };
let transcriptListener: ((text: string) => void) | null = null;
let assistantListener: ((event: AssistantStreamEvent) => void) | null = null;

vi.mock("@renderer/stores/voice-store", () => ({
  useVoiceStore: {
    getState: () => ({ state: voiceState, speakText, flushSpeech, reset }),
  },
  onUserTranscript: (listener: (text: string) => void) => {
    transcriptListener = listener;
    return () => {
      transcriptListener = null;
    };
  },
}));

vi.mock("@renderer/stores/agent-store", () => ({
  useAgentStore: { getState: () => ({ send }) },
  onAssistantStream: (listener: (event: AssistantStreamEvent) => void) => {
    assistantListener = listener;
    return () => {
      assistantListener = null;
    };
  },
}));

const { installVoiceNarration } = await import("@renderer/voice/narration");

function emit(event: AssistantStreamEvent): void {
  assistantListener?.(event);
}

let dispose: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(() => Promise.resolve());
  voiceState = { kind: "idle" };
  dispose = installVoiceNarration();
});

afterEach(() => {
  dispose();
});

describe("narration (assistant → voice)", () => {
  it("stays silent while the mic is closed", () => {
    emit({ kind: "delta", text: "hello" });
    emit({ kind: "end" });
    expect(speakText).not.toHaveBeenCalled();
    expect(flushSpeech).not.toHaveBeenCalled();
  });

  it("speaks deltas and flushes at the end while listening", () => {
    voiceState = { kind: "listening" };
    emit({ kind: "delta", text: "one " });
    emit({ kind: "delta", text: "two" });
    emit({ kind: "end" });
    expect(speakText.mock.calls.map(([text]) => text)).toEqual(["one ", "two"]);
    expect(flushSpeech).toHaveBeenCalledTimes(1);
  });

  it("resets voice when the chat is wiped, regardless of mic state", () => {
    emit({ kind: "reset" });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("stops narrating after dispose", () => {
    voiceState = { kind: "listening" };
    dispose();
    dispose = () => {};
    emit({ kind: "delta", text: "ignored" });
    expect(speakText).not.toHaveBeenCalled();
  });
});

describe("transcripts (voice → chat)", () => {
  it("routes a final transcript through the normal send path", async () => {
    transcriptListener?.("open my notes");
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith("open my notes"));
  });

  it("serializes rapid transcripts in spoken order", async () => {
    const order: string[] = [];
    send.mockImplementation(async (text: string) => {
      order.push(`start:${text}`);
      await Promise.resolve();
      order.push(`end:${text}`);
    });

    transcriptListener?.("first");
    transcriptListener?.("second");

    await vi.waitFor(() => expect(order).toHaveLength(4));
    // "second" must not start until "first" has finished.
    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  it("keeps the chain alive when one send rejects", async () => {
    send.mockRejectedValueOnce(new Error("offline"));
    transcriptListener?.("doomed");
    transcriptListener?.("survivor");
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith("survivor"));
  });
});
