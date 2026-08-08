// ---------------------------------------------------------------------------
// The host's event channel — one bus PER Durable Object instance.
//
// A listener set at MODULE scope would be catastrophic: one Worker isolate
// serves many tenants' Durable Objects in one module scope, so it would fan one
// user's events out to every other user's sockets. The bus is therefore an
// instance field, constructed with the object it belongs to and dying with
// it.
// ---------------------------------------------------------------------------

import type { EventMethod, IpcEvent } from "@repo/bridge/ipc-contract";

type HostEventListener = (method: EventMethod, payload: unknown) => void;

export class HostEvents {
  private readonly listeners = new Set<HostEventListener>();

  /** Emit an event-kind registry entry. The payload type is resolved from the
   * registry, so a renamed event channel is a compile error at the emit site. */
  emit<K extends EventMethod>(method: K, payload: IpcEvent<K>): void {
    for (const listener of this.listeners) listener(method, payload);
  }

  /** Subscribe to every emitted event. Returns unsubscribe. */
  onAny(listener: HostEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
