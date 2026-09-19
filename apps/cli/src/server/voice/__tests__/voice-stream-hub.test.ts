import { afterEach, describe, expect, it, vi } from "vitest";
import { STREAM_IDLE_TIMEOUT_MS } from "../voice-stream-connection";
import type { VoiceStreamSocket } from "../voice-stream-connection";
import { MAX_CONCURRENT_STREAM_SESSIONS, VoiceStreamHub } from "../voice-stream-hub";
import type { StreamHandlers, StreamSession } from "../stream-session";
import type { VoiceService } from "../voice-service";

interface FakeSocket {
  socket: VoiceStreamSocket;
  sent: string[];
  closes: { code: number | undefined; reason: string | undefined }[];
  terminated: () => number;
}

// records its close but never fires onClose: a stuck client.
const fakeSocket = (): FakeSocket => {
  const sent: string[] = [];
  const closes: { code: number | undefined; reason: string | undefined }[] = [];
  let terminated = 0;
  const socket: VoiceStreamSocket = {
    close: (code, reason) => {
      closes.push({ code, reason });
    },
    raw: {
      terminate: () => {
        terminated += 1;
      },
    },
    readyState: 1,
    send: (data) => {
      sent.push(data);
    },
  };
  return { closes, sent, socket, terminated: () => terminated };
};

interface FakeSession extends StreamSession {
  pushed: ArrayBuffer[];
  finalized: number;
  disposed: boolean;
  handlers: StreamHandlers;
}

const makeFakeSession = (handlers: StreamHandlers): FakeSession => {
  const session: FakeSession = {
    dispose: () => {
      session.disposed = true;
    },
    disposed: false,
    finalize: () => {
      session.finalized += 1;
    },
    finalized: 0,
    handlers,
    pushPcm: (pcm) => {
      session.pushed.push(pcm);
    },
    pushed: [],
  };
  return session;
};

const fakeVoice = () => {
  let created = 0;
  const sessions: FakeSession[] = [];
  const model = { id: "fake", label: "Fake", sizeBytes: 1 };
  const voice: VoiceService = {
    createStreamSession: (handlers) => {
      created += 1;
      const session = makeFakeSession(handlers);
      sessions.push(session);
      return session;
    },
    dispose: async () => {
      // nothing to stop
    },
    install: async () => ({ model, state: "ready" }),
    remove: async () => ({ model, state: "ready" }),
    status: async () => ({ model, state: "ready" }),
  };
  return { created: () => created, sessions, voice };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("VoiceStreamHub teardown", () => {
  it("terminates a stuck socket after the drain — closeAllClients does not forget it", () => {
    const { voice, sessions } = fakeVoice();
    const hub = new VoiceStreamHub(voice);
    const fake = fakeSocket();
    hub.open(fake.socket);
    expect(hub.size).toBe(1);
    const [session] = sessions;
    if (session === undefined) {
      throw new Error("no session");
    }

    hub.closeAllClients();
    expect(fake.closes.at(-1)?.code).toBe(1001);
    expect(session.disposed).toBe(true);
    expect(fake.terminated()).toBe(0);

    hub.terminateAllClients();
    expect(fake.terminated()).toBe(1);
  });
});

describe("VoiceStreamHub cap", () => {
  it("refuses opens past the cap without minting a session", () => {
    const { voice, created } = fakeVoice();
    const hub = new VoiceStreamHub(voice);
    for (let index = 0; index < MAX_CONCURRENT_STREAM_SESSIONS; index += 1) {
      hub.open(fakeSocket().socket);
    }
    expect(hub.size).toBe(MAX_CONCURRENT_STREAM_SESSIONS);
    expect(created()).toBe(MAX_CONCURRENT_STREAM_SESSIONS);

    const overflow = fakeSocket();
    hub.open(overflow.socket);
    expect(created()).toBe(MAX_CONCURRENT_STREAM_SESSIONS);
    expect(hub.size).toBe(MAX_CONCURRENT_STREAM_SESSIONS);
    expect(overflow.sent.some((frame) => frame.includes("Too many"))).toBe(true);
    expect(overflow.closes.at(-1)?.code).toBe(1008);
  });
});

describe("VoiceStreamHub idle reap", () => {
  it("terminates and reaps a session that stops sending frames", () => {
    vi.useFakeTimers();
    const { voice, sessions } = fakeVoice();
    const hub = new VoiceStreamHub(voice);
    const fake = fakeSocket();
    hub.open(fake.socket);
    const [session] = sessions;
    if (session === undefined) {
      throw new Error("no session");
    }

    vi.advanceTimersByTime(STREAM_IDLE_TIMEOUT_MS + 1);
    expect(fake.terminated()).toBe(1);
    expect(session.disposed).toBe(true);
  });

  it("does not reap while frames keep arriving", () => {
    vi.useFakeTimers();
    const { voice } = fakeVoice();
    const hub = new VoiceStreamHub(voice);
    const fake = fakeSocket();
    const connection = hub.open(fake.socket);

    vi.advanceTimersByTime(STREAM_IDLE_TIMEOUT_MS - 1);
    connection.receive(new ArrayBuffer(4));
    vi.advanceTimersByTime(STREAM_IDLE_TIMEOUT_MS - 1);
    expect(fake.terminated()).toBe(0);
  });
});
