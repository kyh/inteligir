// What partysocket needs of the platform before it loads: an EventTarget, and under React Native,
// where it re-dispatches each message as `new MessageEvent(...)`, a MessageEvent global, which
// React Native does not define.

import "partysocket/event-target-polyfill";

if (!("MessageEvent" in globalThis)) {
  class MessageEvent extends Event {
    readonly data: unknown;

    constructor(type: string, init?: { readonly data?: unknown }) {
      super(type);
      this.data = init?.data;
    }
  }
  Object.defineProperty(globalThis, "MessageEvent", { configurable: true, value: MessageEvent });
}
