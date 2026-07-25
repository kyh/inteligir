// ---------------------------------------------------------------------------
// The voice ↔ chat wiring, owned by VOICE.
//
// Both directions used to live inside stores/agent-store.ts, which meant the
// core chat store imported the voice store and poked at it — so voice, an
// optional capability, was load-bearing in the one store every chat surface
// depends on. Now the chat store only broadcasts (`onAssistantStream`) and
// exposes `send()`; this module is the sole place that knows both exist, and
// deleting voice means deleting this file plus one call in app-root.
//
// Two directions:
//   out — a streamed assistant reply is narrated while the mic is listening.
//   in  — a completed transcript becomes an ordinary user turn.
// ---------------------------------------------------------------------------

import { onAssistantStream, useAgentStore } from "@renderer/stores/agent-store";
import { onUserTranscript, useVoiceStore } from "@renderer/stores/voice-store";

/**
 * Install both directions. Returns a disposer; call once at app start
 * (app-root) alongside the chat store's own init.
 */
export function installVoiceNarration(): () => void {
  const unsubAssistant = onAssistantStream((event) => {
    const voice = useVoiceStore.getState();
    if (event.kind === "reset") {
      voice.reset();
      return;
    }
    // Narrate only while the mic is open — a typed conversation stays silent.
    if (voice.state.kind !== "listening") return;
    if (event.kind === "delta") voice.speakText(event.text);
    else voice.flushSpeech();
  });

  // A completed voice transcript is just a user turn: route it through the SAME
  // send() as a typed message, so flush, note-context, failed-flush handling and
  // the logout bail all live in one place and can't drift. Serialize so rapid
  // transcripts dispatch (and their bubbles append) in spoken order; send() is
  // async, so without the chain two could race.
  let voiceChain: Promise<unknown> = Promise.resolve();
  const unsubTranscript = onUserTranscript((text) => {
    voiceChain = voiceChain.then(() => useAgentStore.getState().send(text)).catch(() => undefined);
  });

  return () => {
    unsubAssistant();
    unsubTranscript();
  };
}
