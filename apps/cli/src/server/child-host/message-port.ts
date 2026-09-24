// Electron gives a utility process `process.parentPort`, and every message on it or on a
// MessagePortMain arrives as `{ data, ports }`. this package compiles without Electron's types, so
// these interfaces name what the server relies on, and the parent port is checked for it once.

import { EventEmitter } from "node:events";
import { z } from "zod";
import type { ChildToParentMessage, ParentToChildMessage } from "../vault/watcher/messages";
import { attachFrameSchema } from "./fork-broker-wire";
import type { ForkRequest } from "./fork-broker-wire";
import type { FromChildFrame, ToChildFrame } from "./stdio-frames";

// every frame a brokered child's channel carries, each way: a watcher's and an adapter's stdio.
export type PortFrame = ParentToChildMessage | ChildToParentMessage | ToChildFrame | FromChildFrame;

// `data` is a structured clone its listener has yet to parse; `ports` are ones it transferred.
export interface PortMessageEvent {
  data: unknown;
  ports: readonly MessagePortLike[];
}

export interface MessagePortLike {
  postMessage: (message: PortFrame) => void;
  on: {
    (event: "message", listener: (message: PortMessageEvent) => void): void;
    (event: "close", listener: () => void): void;
  };
  start: () => void;
}

// the server posts main one thing: a fork to make.
export interface ParentPortLike {
  postMessage: (message: ForkRequest) => void;
  on: (event: "message", listener: (message: PortMessageEvent) => void) => void;
}

// Electron's ParentPort is a node EventEmitter that posts; nothing else puts one on `process`.
const parentPortSchema = z.custom<ParentPortLike>(
  (value) =>
    value instanceof EventEmitter &&
    "postMessage" in value &&
    value.postMessage instanceof Function,
);

// null outside a utility process: plain node, a worker thread, vitest.
export const readParentPort = (): ParentPortLike | null => {
  const parsed = parentPortSchema.safeParse("parentPort" in process ? process.parentPort : null);
  return parsed.success ? parsed.data : null;
};

// a forked child's first frame from main carries its end of the channel to the server.
export const attachedPort = async (parentPort: ParentPortLike): Promise<MessagePortLike> => {
  const attached = Promise.withResolvers<MessagePortLike>();
  parentPort.on("message", ({ data, ports: [port] }) => {
    if (port !== undefined && attachFrameSchema.safeParse(data).success) {
      attached.resolve(port);
    }
  });
  return await attached.promise;
};
