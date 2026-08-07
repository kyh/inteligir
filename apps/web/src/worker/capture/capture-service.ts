// ---------------------------------------------------------------------------
// What a deep link DOES once it has been parsed: a capture goes to the durable
// inbox, a nav is pushed and parked.
//
// The parking is the cold-start half of the same contract the desktop had. A
// link can arrive while nobody is connected — a phone opening the URL before
// the workspace tab has finished authenticating — and an event pushed to zero
// sockets is a nav the user asked for and never got. So it is also written to
// the object's KV, and the first client to ask pulls-and-clears it. The id
// stamp is what lets a client that receives BOTH (it subscribed just before it
// pulled) dedupe them.
//
// One parked nav, not a queue: a nav supersedes rather than accumulates —
// nobody wants three notes opened in sequence because they clicked three links
// while the app was closed.
// ---------------------------------------------------------------------------

import type { DeepLinkAction, DeepLinkNav, DeepLinkNavEvent } from "@repo/bridge/deep-link";
import { isRecord } from "@repo/bridge/wire-helpers";

import type { CaptureInbox } from "./capture-inbox";
import type { DeletableDurableKv } from "../store/durable-kv";

const PARKED_NAV_KEY = "capture/parked-nav";

export type CaptureServiceDeps = {
  readonly kv: DeletableDurableKv;
  readonly inbox: CaptureInbox;
  /** Push a nav to connected clients (`onDeepLinkNav`). */
  readonly onNav: (event: DeepLinkNavEvent) => void;
};

/** What a delivered link did, so the route can answer something a caller can
 * act on rather than a bare 204. */
export type DeepLinkDelivery =
  | { readonly kind: "capture"; readonly id: string }
  | { readonly kind: "nav"; readonly nav: DeepLinkNav };

export class CaptureService {
  private readonly deps: CaptureServiceDeps;

  constructor(deps: CaptureServiceDeps) {
    this.deps = deps;
  }

  /** Act on one parsed link, or `null` for a verb this host does not serve. */
  deliver(action: DeepLinkAction): DeepLinkDelivery | null {
    if (action.kind === "capture") {
      return { kind: "capture", id: this.deps.inbox.enqueue(action.capture, action.text) };
    }
    if (action.kind === "nav") {
      const event: DeepLinkNavEvent = { id: crypto.randomUUID(), nav: action.nav };
      this.deps.kv.put(PARKED_NAV_KEY, event);
      this.deps.onNav(event);
      return { kind: "nav", nav: action.nav };
    }
    // `session` — a web client is already signed in. See ./deep-link.
    return null;
  }

  /** Pull-and-clear the parked nav. Callers subscribe to `onDeepLinkNav`
   * BEFORE pulling and dedupe by id — the reverse order silently drops a nav
   * landing between the two. */
  takePendingNav(): DeepLinkNavEvent | null {
    const stored = this.deps.kv.get(PARKED_NAV_KEY);
    this.deps.kv.delete(PARKED_NAV_KEY);
    return readNavEvent(stored);
  }
}

/** Prove a parked event's shape rather than assume it: what comes back is JSON
 * some earlier version of this code wrote. */
function readNavEvent(value: unknown): DeepLinkNavEvent | null {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const nav = value["nav"];
  if (typeof id !== "string" || !isRecord(nav)) return null;
  if (nav["kind"] === "today") return { id, nav: { kind: "today" } };
  if (nav["kind"] === "note" && typeof nav["target"] === "string") {
    return { id, nav: { kind: "note", target: nav["target"] } };
  }
  if (nav["kind"] === "search" && typeof nav["query"] === "string") {
    return { id, nav: { kind: "search", query: nav["query"] } };
  }
  return null;
}
