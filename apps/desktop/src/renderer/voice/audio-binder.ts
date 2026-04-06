// ---------------------------------------------------------------------------
// Audio element lifecycle — subscribes to VoiceSession, manages <audio> DOM.
// Isolates all DOM access from the session's network logic.
// ---------------------------------------------------------------------------

import type { RemoteTrack } from "livekit-client";
import type { VoiceSession } from "./session";

const AUDIO_ELEMENT_ID = "livekit-agent-audio";

/**
 * Bind audio track events from a VoiceSession to DOM <audio> elements.
 * Returns a teardown function that unsubscribes and cleans up the element.
 */
export function bindAudio(session: VoiceSession): () => void {
  const unsub = session.on((event) => {
    switch (event.type) {
      case "audio_track_subscribed": {
        document.getElementById(AUDIO_ELEMENT_ID)?.remove();
        const track = event.track as RemoteTrack;
        const el = track.attach();
        el.id = AUDIO_ELEMENT_ID;
        document.body.appendChild(el);
        break;
      }
      case "audio_track_unsubscribed": {
        const track = event.track as RemoteTrack;
        for (const el of track.detach()) el.remove();
        break;
      }
      case "state_changed": {
        if (event.state === "inactive") {
          document.getElementById(AUDIO_ELEMENT_ID)?.remove();
        }
        break;
      }
    }
  });

  return () => {
    unsub();
    document.getElementById(AUDIO_ELEMENT_ID)?.remove();
  };
}
