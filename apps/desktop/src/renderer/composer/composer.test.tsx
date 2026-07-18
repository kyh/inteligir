// The composer's controlled draft (jsdom): typing/submit/Escape all go through
// state, attachments submit as base64 data-URL payloads, and a confirmed voice
// transcript appends via setDraft — the harness can't drive real STT (it needs
// a live mic + AudioWorklet), so the transcript→draft path is unit-tested here.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No vitest globals in this repo, so testing-library can't auto-cleanup.
afterEach(cleanup);

// jsdom has no matchMedia; framer-motion consults it for reduced-motion.
vi.stubGlobal(
  "matchMedia",
  (media: string): MediaQueryList => ({
    matches: false,
    media,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
);

const agent = vi.hoisted(() => ({
  send: vi.fn((..._args: unknown[]) => Promise.resolve({ flushed: true })),
  interrupt: vi.fn(),
  busy: false,
}));

const voice = vi.hoisted(() => ({
  phase: "idle" as "idle" | "starting" | "listening" | "stopping",
  transcript: "",
  confirmResult: "",
}));

type AgentStoreShape = {
  appState: { phase: "ready"; agent: "idle" | "busy" };
  send: typeof agent.send;
  interrupt: typeof agent.interrupt;
  queuedFollowUp: string[];
  queuedSteering: string[];
};

vi.mock("@renderer/stores/agent-store", () => ({
  useAgentStore: <T,>(selector: (s: AgentStoreShape) => T): T =>
    selector({
      appState: { phase: "ready", agent: agent.busy ? "busy" : "idle" },
      send: agent.send,
      interrupt: agent.interrupt,
      queuedFollowUp: [],
      queuedSteering: [],
    }),
}));

vi.mock("@renderer/voice/use-voice-capture", () => ({
  useVoiceCapture: () => ({
    phase: voice.phase,
    transcript: voice.transcript,
    start: () => Promise.resolve(),
    cancel: () => {},
    confirm: () => Promise.resolve(voice.confirmResult),
  }),
}));

// The real module lazy-loads a WebGL orb; stub the motion surface for jsdom.
vi.mock("@renderer/composer/capsule-motion", () => ({
  CAPSULE_CONTENT_HIDDEN: { opacity: 0 },
  CAPSULE_CONTENT_VISIBLE: { opacity: 1 },
  CAPSULE_RADIUS: 24,
  CAPSULE_SURFACE: "",
  ListeningGlow: () => null,
  ListeningOrb: () => null,
  useCapsuleSpring: () => ({
    capsule: { duration: 0 },
    content: { duration: 0 },
    reduceMotion: true,
  }),
}));

import { Composer } from "./composer";

beforeEach(() => {
  agent.send.mockClear();
  agent.busy = false;
  voice.phase = "idle";
  voice.transcript = "";
  voice.confirmResult = "";
});

function expandComposer() {
  fireEvent.click(screen.getByRole("button", { name: /Ask the agent/ }));
}

function getTextarea(): HTMLTextAreaElement {
  const el = screen.getByPlaceholderText("Ask the agent to edit your notes…");
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("composer textarea missing");
  return el;
}

describe("Composer (controlled draft)", () => {
  it("types into the draft, enables send, and Enter submits then clears", async () => {
    render(<Composer />);
    expandComposer();

    const ta = getTextarea();
    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(ta, { target: { value: "hello agent" } });
    expect(ta.value).toBe("hello agent");
    expect(sendButton.hasAttribute("disabled")).toBe(false);

    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(agent.send).toHaveBeenCalledTimes(1));
    expect(agent.send).toHaveBeenCalledWith("hello agent", undefined, undefined);
    await waitFor(() => expect(getTextarea().value).toBe(""));
  });

  it("clears the draft on Escape", () => {
    render(<Composer />);
    expandComposer();

    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: "discard me" } });
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(getTextarea().value).toBe("");
  });

  it("appends a confirmed voice transcript to the drafted text", async () => {
    const { rerender } = render(<Composer />);
    expandComposer();
    fireEvent.change(getTextarea(), { target: { value: "hello " } });

    voice.phase = "listening";
    voice.confirmResult = "world";
    rerender(<Composer />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm voice input" }));
    await waitFor(() => expect(getTextarea().value).toBe("hello world"));
  });

  it("lands a confirmed voice transcript as the whole draft when empty", async () => {
    voice.phase = "listening";
    voice.confirmResult = "just the transcript";
    render(<Composer />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm voice input" }));
    await waitFor(() => expect(getTextarea().value).toBe("just the transcript"));
  });

  it("submits an attached image as a base64 data-url payload", async () => {
    render(<Composer />);
    expandComposer();

    const file = new File([new Uint8Array([137, 80, 78, 71])], "pic.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [file] } });
    // The tray stages the attachment once its base64 data URL is read.
    await screen.findByAltText("pic.png");

    fireEvent.keyDown(getTextarea(), { key: "Enter" });
    await waitFor(() => expect(agent.send).toHaveBeenCalledTimes(1));
    expect(agent.send).toHaveBeenCalledWith(
      "",
      [{ data: "iVBORw==", mimeType: "image/png" }],
      undefined,
    );
  });
});
