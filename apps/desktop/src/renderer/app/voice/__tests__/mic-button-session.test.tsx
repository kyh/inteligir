// @vitest-environment jsdom

/* oxlint-disable max-classes-per-file, class-methods-use-this -- stand-ins for the two host
   constructors a session news up, WebSocket and AudioContext; their API is reached on the
   instance, never as statics */

import type { VoiceStatusResponse } from "@repo/api/local/voice/voice-schema";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MicButton } from "../mic-button";

const READY: VoiceStatusResponse = {
  model: {
    id: "sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8",
    label: "Parakeet streaming (English)",
    sizeBytes: 105_913_204,
  },
  state: "ready",
};

interface FakeTrack {
  stopped: boolean;
  stop: () => void;
}
interface FakeStream {
  getTracks: () => FakeTrack[];
}

// one per session, in the order they were dialled; firing `close` ends a session the user did not
let sockets: ScriptedSocket[] = [];
let permissionAsks: PromiseWithResolvers<FakeStream>[] = [];

class ScriptedSocket {
  binaryType = "blob";
  readonly #listeners = new Map<string, () => void>();
  constructor() {
    sockets.push(this);
  }
  addEventListener = (type: string, listener: () => void): void => {
    this.#listeners.set(type, listener);
  };
  send = (): void => {};
  close = (): void => {};
  fire(type: string): void {
    this.#listeners.get(type)?.();
  }
}

const audioNode = () => ({ connect: (): void => {}, disconnect: (): void => {} });
class SilentAudioContext {
  sampleRate = 16_000;
  destination = audioNode();
  createMediaStreamSource = () => audioNode();
  createScriptProcessor = () => ({ ...audioNode(), onaudioprocess: null });
  createAnalyser = () => ({ ...audioNode(), fftSize: 0, getFloatTimeDomainData: (): void => {} });
  close = async (): Promise<void> => {};
}

// answers the nth permission ask with a live microphone, and hands back its track
const grant = async (ask: number): Promise<FakeTrack> => {
  const track: FakeTrack = {
    stop: () => {
      track.stopped = true;
    },
    stopped: false,
  };
  await act(async () => {
    permissionAsks[ask]?.resolve({ getTracks: () => [track] });
    await Promise.resolve();
  });
  return track;
};

beforeEach(() => {
  sockets = [];
  permissionAsks = [];
  // the meter's tick would re-render outside act; nothing here reads the level
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.stubGlobal("WebSocket", ScriptedSocket);
  vi.stubGlobal("AudioContext", SilentAudioContext);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (): Promise<FakeStream> => {
        const ask = Promise.withResolvers<FakeStream>();
        permissionAsks.push(ask);
        return await ask.promise;
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("a microphone grant that lands after its session ended", () => {
  it("stops only its own capture, so the live session's microphone still stops", async () => {
    render(
      <MicButton status={READY} onTranscript={() => {}} onPartial={() => {}} disabled={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
    act(() => {
      sockets[0]?.fire("close");
    });
    fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
    expect(permissionAsks).toHaveLength(2);

    const live = await grant(1);
    const stale = await grant(0);
    expect(stale.stopped).toBe(true);
    expect(live.stopped).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Stop dictating" }));
    expect(live.stopped).toBe(true);
  });
});
