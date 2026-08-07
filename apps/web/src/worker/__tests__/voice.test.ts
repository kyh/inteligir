// ---------------------------------------------------------------------------
// Voice: the WAV encoding, the speakable cut, and both sessions driven for real
// against fake UPSTREAMS.
//
// The sessions are constructor-injectable precisely so this suite is the
// production code with a stand-in vendor rather than a parallel implementation
// of it — the buffering, the epoch guard, the partial budget and the caps are
// all the ones a real utterance goes through.
// ---------------------------------------------------------------------------

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { UI_STATE_OPEN_NOTE_KEY } from "@repo/bridge/ui-state";
import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/bridge/voice";

import { userHostName } from "../host/host-address";
import { SEED_OPEN_NOTE } from "../host/vault/seed";
import { authenticated, invoke, signUp } from "./host-helpers";
import { SttSession, type SttTranscript } from "../voice/stt-session";
import { cutSpeakable, TtsSession, type TtsSynthesizer } from "../voice/tts-session";
import { encodeWav, STT_SAMPLE_RATE, toFloat32Samples } from "../voice/wav";

/** Run every deferred promise the sessions handed the object. */
async function settle(deferred: Promise<unknown>[]): Promise<void> {
  await Promise.all(deferred.splice(0, deferred.length));
}

describe("wav encoding", () => {
  it("writes a RIFF header the model can read", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]));
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(STT_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(6); // 3 samples × 2 bytes
    expect(wav.byteLength).toBe(44 + 6);
  });

  it("clamps before scaling, so an out-of-range sample is not a click", () => {
    const wav = encodeWav(new Float32Array([2, -2]));
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_767);
  });

  it("narrows an audio payload, and refuses anything that is not one", () => {
    const buffer = new Float32Array([0.5]).buffer;
    expect(toFloat32Samples(buffer)?.[0]).toBeCloseTo(0.5);
    // A view inside a larger pooled buffer must be read at its own offset.
    const pool = new Float32Array([9, 0.25, 9]);
    expect(toFloat32Samples(pool.subarray(1, 2))?.[0]).toBeCloseTo(0.25);
    // The registry types this channel `unknown`, so the shape is proven here.
    expect(toFloat32Samples({ audio: "hi" })).toBeNull();
    expect(toFloat32Samples(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("the speakable cut", () => {
  it("holds a delta that is not yet a sentence", () => {
    expect(cutSpeakable("The quick brown")).toEqual({ chunks: [], rest: "The quick brown" });
  });

  it("cuts at the LAST terminator, so a request ends on a prosody boundary", () => {
    const long = `${"a".repeat(70)}. ${"b".repeat(70)}. tail`;
    const cut = cutSpeakable(long);
    expect(cut.chunks).toHaveLength(1);
    expect(cut.chunks[0]?.endsWith(".")).toBe(true);
    expect(cut.rest.trim()).toBe("tail");
  });

  it("speaks at the ceiling when the model streams without punctuation", () => {
    const cut = cutSpeakable("word ".repeat(200));
    expect(cut.chunks.length).toBeGreaterThan(0);
    for (const chunk of cut.chunks) expect(chunk.length).toBeLessThanOrEqual(400);
  });
});

/** A synthesizer that records what it was asked for and answers one frame. */
function fakeSynthesizer(): { synthesize: TtsSynthesizer; spoken: string[] } {
  const spoken: string[] = [];
  return {
    spoken,
    synthesize: (text, _signal, onAudio) => {
      spoken.push(text);
      onAudio(new Uint8Array([1, 2, 3, 4]));
      return Promise.resolve({ ok: true as const });
    },
  };
}

describe("the tts session", () => {
  it("buffers deltas and synthesizes whole sentences", async () => {
    const deferred: Promise<unknown>[] = [];
    const upstream = fakeSynthesizer();
    const frames: Uint8Array[] = [];
    const session = new TtsSession({
      synthesize: upstream.synthesize,
      emitAudio: (pcm) => frames.push(pcm),
      defer: (work) => deferred.push(work),
      available: () => true,
    });

    const sentence = "The quick brown fox jumps over the lazy dog, and then it did so once more";
    for (const delta of [
      "The quick brown fox jumps ",
      "over the lazy dog, and then ",
      "it did so once more",
      ". Then it ",
      "slept",
    ]) {
      session.send(delta);
      // Nothing is spoken until a terminator lands past the minimum: one
      // request per streamed delta is what this bound exists to prevent.
      if (!delta.startsWith(".")) expect(upstream.spoken).toHaveLength(0);
    }
    await settle(deferred);
    expect(upstream.spoken).toEqual([`${sentence}.`]);

    session.flush();
    await settle(deferred);
    expect(upstream.spoken).toEqual([`${sentence}.`, "Then it slept"]);
    expect(frames).toHaveLength(2);
  });

  it("drops queued and in-flight audio on an interrupt", async () => {
    const deferred: Promise<unknown>[] = [];
    const frames: Uint8Array[] = [];
    const inFlight: (() => void)[] = [];
    const session = new TtsSession({
      synthesize: async (_text, _signal, onAudio) => {
        await new Promise<void>((resolve) => inFlight.push(resolve));
        // Frames already in the reader's buffer belong to the sentence the user
        // just stopped, so the epoch is re-checked per frame.
        onAudio(new Uint8Array([9]));
        return { ok: true as const };
      },
      emitAudio: (pcm) => frames.push(pcm),
      defer: (work) => deferred.push(work),
      available: () => true,
    });

    session.send("A whole sentence that is long enough to be spoken right away.");
    await vi.waitFor(() => expect(inFlight).toHaveLength(1));
    session.interrupt();
    inFlight[0]?.();
    await settle(deferred);
    expect(frames).toEqual([]);
  });

  it("says nothing at all when no key is configured", async () => {
    const deferred: Promise<unknown>[] = [];
    const upstream = fakeSynthesizer();
    const session = new TtsSession({
      synthesize: upstream.synthesize,
      emitAudio: () => undefined,
      defer: (work) => deferred.push(work),
      available: () => false,
    });
    session.send("Something long enough to be a whole speakable sentence right here.");
    session.flush();
    await settle(deferred);
    expect(upstream.spoken).toEqual([]);
  });
});

describe("the stt session", () => {
  it("refuses to start when the deployment cannot transcribe", async () => {
    const session = new SttSession({
      transcribe: () => Promise.resolve({ ok: false as const, error: "no" }),
      emitTranscript: () => undefined,
      defer: () => undefined,
      available: () => false,
    });
    expect(session.start()).toEqual({
      ok: false,
      error: "Speech recognition is not configured on this deployment.",
    });
    // A refused start accepts no audio and answers no transcript.
    session.push(new Float32Array(16));
    expect(await session.stop()).toEqual([]);
  });

  it("RETURNS the final transcript rather than emitting it", async () => {
    // The renderer stops listening to onSttTranscript before it calls stop, so
    // the tail events are the return value by contract.
    const emitted: SttTranscript[] = [];
    const session = new SttSession({
      transcribe: (wav) => Promise.resolve({ ok: true as const, text: `wav:${wav.byteLength}` }),
      emitTranscript: (transcript) => emitted.push(transcript),
      defer: () => undefined,
      available: () => true,
    });
    expect(session.start()).toEqual({ ok: true });
    session.push(new Float32Array(2048));
    expect(await session.stop()).toEqual([{ text: `wav:${44 + 2048 * 2}`, isFinal: true }]);
    expect(emitted).toEqual([]);
  });

  it("emits a partial once enough speech has accumulated, and only so many", async () => {
    // Every partial re-transcribes the whole buffer, so the count is capped —
    // the cadence regression request/response forces (see stt-session's header).
    const deferred: Promise<unknown>[] = [];
    const emitted: SttTranscript[] = [];
    let calls = 0;
    const session = new SttSession({
      transcribe: () => {
        calls += 1;
        return Promise.resolve({ ok: true as const, text: `partial ${calls}` });
      },
      emitTranscript: (transcript) => emitted.push(transcript),
      defer: (work) => deferred.push(work),
      available: () => true,
    });
    session.start();
    // Ten five-second blocks against a budget of six partials.
    for (let block = 0; block < 10; block += 1) {
      session.push(new Float32Array(STT_SAMPLE_RATE * 5));
      await settle(deferred);
    }
    expect(emitted).toHaveLength(6);
    expect(emitted.every((transcript) => !transcript.isFinal)).toBe(true);
  });
});

describe("the voice secret", () => {
  it("seals the key, marks its presence, and never hands the plaintext back out", async () => {
    const stub = env.UserHost.getByName(userHostName("voice-fixture"));
    await runInDurableObject(stub, async (host) => {
      expect(host.voice.secret.present()).toBe(false);

      await host.voice.secret.set("  el-key-123  ");
      expect(host.voice.secret.present()).toBe(true);
      expect(await host.voice.secret.read()).toBe("el-key-123");

      await host.voice.secret.set("   ");
      expect(host.voice.secret.present()).toBe(false);
      expect(await host.voice.secret.read()).toBeNull();
    });
  });

  it("keeps the ui-state marker in step, so Settings and the seal cannot disagree", async () => {
    const account = await signUp("voice-marker@example.com");
    const { ws, frames } = await authenticated(account);

    expect(await invoke(ws, frames, 1, "isTtsAvailable")).toMatchObject({
      ok: true,
      result: false,
    });
    await invoke(ws, frames, 2, "setVoiceApiKey", { value: "el-key" });
    expect(await invoke(ws, frames, 3, "isTtsAvailable")).toMatchObject({ ok: true, result: true });

    // Presence ONLY — the plaintext never crosses back over the Bridge. The
    // other key is the seed's landing note, written when this account first
    // authenticated (../host/vault/seed).
    const state = await invoke(ws, frames, 4, "getUiState");
    expect(state.ok && state.result).toEqual({
      [ELEVENLABS_API_KEY_UI_STATE]: true,
      [UI_STATE_OPEN_NOTE_KEY]: SEED_OPEN_NOTE,
    });

    await invoke(ws, frames, 5, "setVoiceApiKey", {});
    expect(await invoke(ws, frames, 6, "isTtsAvailable")).toMatchObject({
      ok: true,
      result: false,
    });
    expect((await invoke(ws, frames, 7, "getUiState")).ok).toBe(true);
    ws.close();
  });
});
