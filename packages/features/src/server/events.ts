// ---------------------------------------------------------------------------
// Typed host event channel. Host code emits registry event-kind payloads
// here; the transport (the ws host) subscribes and forwards. The emitter is
// module-level to match the one-host-per-process singleton model.
// ---------------------------------------------------------------------------

import type { EventMethod, IpcEvent } from "@repo/features/ipc-registry";

type EventsListener = (method: EventMethod, payload: unknown) => void;

const listeners = new Set<EventsListener>();

/**
 * Emit an event-kind IPC entry to every subscribed transport. The method's
 * payload type is resolved from the registry, so a renamed event channel is
 * a compile error here.
 */
export function emitEvent<K extends EventMethod>(method: K, payload: IpcEvent<K>): void {
  for (const listener of listeners) {
    listener(method, payload);
  }
}

/** Subscribe a transport to every emitted event. Returns unsubscribe. */
export function subscribeEvents(listener: EventsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
