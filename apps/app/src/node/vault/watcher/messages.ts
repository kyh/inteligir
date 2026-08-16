// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// Wire protocol between the server parent and the parcel watcher child. Every
// payload must be structured-clone / JSON safe (no functions, no Error
// instances) — parcel events already are ({path, type}); errors travel as
// their message string.

import type { ParcelWatcherSubscribeOptions } from "./parcel-backend";

export interface SerializedParcelEvent {
  path: string;
  type: "create" | "update" | "delete";
}

export type ParentToChildMessage =
  | {
      kind: "subscribe";
      id: string;
      dir: string;
      opts: ParcelWatcherSubscribeOptions | undefined;
      // Set when re-subscribing onto a freshly respawned child. The child
      // re-emits the root's current entries once the watch is armed so callers
      // reconcile against on-disk state and recover changes missed during the
      // restart gap.
      rescan: boolean;
    }
  | { kind: "unsubscribe"; id: string }
  | { kind: "ping"; nonce: number };

export type ChildToParentMessage =
  | { kind: "ready" }
  | { kind: "pong"; nonce: number }
  | { kind: "subscribed"; id: string }
  | { kind: "subscribe-failed"; id: string; message: string }
  | { kind: "unsubscribed"; id: string }
  | { kind: "events"; id: string; events: SerializedParcelEvent[] }
  | { kind: "watch-error"; id: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSerializedParcelEvent(value: unknown): value is SerializedParcelEvent {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    (value.type === "create" || value.type === "update" || value.type === "delete")
  );
}

/** node's IPC delivers `unknown`; both sides narrow with these instead of a cast. */
export function parseParentToChildMessage(value: unknown): ParentToChildMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value.kind) {
    case "subscribe": {
      if (
        typeof value.id !== "string" ||
        typeof value.dir !== "string" ||
        typeof value.rescan !== "boolean"
      ) {
        return null;
      }
      const opts = isRecord(value.opts) ? readSubscribeOptions(value.opts) : undefined;
      return { kind: "subscribe", id: value.id, dir: value.dir, opts, rescan: value.rescan };
    }
    case "unsubscribe":
      return typeof value.id === "string" ? { kind: "unsubscribe", id: value.id } : null;
    case "ping":
      return typeof value.nonce === "number" ? { kind: "ping", nonce: value.nonce } : null;
    default:
      return null;
  }
}

function readSubscribeOptions(value: Record<string, unknown>): ParcelWatcherSubscribeOptions {
  const ignore = Array.isArray(value.ignore)
    ? value.ignore.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return ignore === undefined ? {} : { ignore };
}

export function parseChildToParentMessage(value: unknown): ChildToParentMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value.kind) {
    case "ready":
      return { kind: "ready" };
    case "pong":
      return typeof value.nonce === "number" ? { kind: "pong", nonce: value.nonce } : null;
    case "subscribed":
      return typeof value.id === "string" ? { kind: "subscribed", id: value.id } : null;
    case "unsubscribed":
      return typeof value.id === "string" ? { kind: "unsubscribed", id: value.id } : null;
    case "subscribe-failed":
    case "watch-error":
      return typeof value.id === "string" && typeof value.message === "string"
        ? { kind: value.kind, id: value.id, message: value.message }
        : null;
    case "events":
      return typeof value.id === "string" && Array.isArray(value.events)
        ? { kind: "events", id: value.id, events: value.events.filter(isSerializedParcelEvent) }
        : null;
    default:
      return null;
  }
}
