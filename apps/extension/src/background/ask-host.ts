// one request to the Mac's native host: a connectNative of its own, one message posted, the first
// reply taken and the port closed. A port per save means a host that crashed or was updated
// between two saves costs nothing, and no port is held open for the worker's whole life.

import { browserHostReplySchema } from "@repo/contract/browser/browser-wire";
import type { BrowserHostReply, BrowserHostRequest } from "@repo/contract/browser/browser-wire";
import { nativeHostName } from "./host-name";

export type HostAnswer =
  | { kind: "reply"; reply: BrowserHostReply }
  // no manifest names the host: no app on this computer
  | { kind: "absent" }
  // a manifest names it, but not for this extension
  | { kind: "forbidden" }
  // the host started and ended without a reply, or replied with something that is not one
  | { kind: "crashed"; detail: string };

// the part of a port askHost uses, its messages already read as replies (null: not one), so a
// suite can stand in for Chrome's
export interface HostPort {
  post: (request: BrowserHostRequest) => void;
  close: () => void;
  onReply: (listener: (reply: BrowserHostReply | null) => void) => void;
  onClose: (listener: () => void) => void;
}

export interface AskHostDeps {
  connect: (hostName: string) => HostPort;
  // chrome.runtime.lastError's message as the port closes
  lastError: () => string | undefined;
}

// the boundary: whatever the host writes is parsed here, before anything reads it
const chromePort = (hostName: string): HostPort => {
  const port = chrome.runtime.connectNative(hostName);
  return {
    close: () => {
      port.disconnect();
    },
    onClose: (listener) => {
      port.onDisconnect.addListener(() => {
        listener();
      });
    },
    onReply: (listener) => {
      port.onMessage.addListener((message) => {
        const parsed = browserHostReplySchema.safeParse(message);
        listener(parsed.success ? parsed.data : null);
      });
    },
    post: (request) => {
      port.postMessage(request);
    },
  };
};

const chromeDeps: AskHostDeps = {
  connect: chromePort,
  lastError: () => chrome.runtime.lastError?.message,
};

// Chrome's own sentences for the two cases a person can act on; anything else is a crash
const NOT_FOUND = "not found.";
const FORBIDDEN = "forbidden.";

export const answerOfDisconnect = (message = ""): HostAnswer => {
  if (message.endsWith(NOT_FOUND)) {
    return { kind: "absent" };
  }
  if (message.endsWith(FORBIDDEN)) {
    return { kind: "forbidden" };
  }
  return {
    detail: message === "" ? "the app's door closed without answering" : message,
    kind: "crashed",
  };
};

export const askHost = async (
  request: BrowserHostRequest,
  deps: AskHostDeps = chromeDeps,
): Promise<HostAnswer> => {
  let port: HostPort;
  try {
    port = deps.connect(nativeHostName());
  } catch (error) {
    return { detail: error instanceof Error ? error.message : String(error), kind: "crashed" };
  }
  // the first of the two to fire answers: a reply, or the port closing without one
  // oxlint-disable-next-line promise/avoid-new -- bridges the port's two events; Chrome 116 has no Promise.withResolvers
  const answer = await new Promise<HostAnswer>((resolve) => {
    port.onReply((reply) => {
      resolve(
        reply === null
          ? { detail: "the app answered something that is not a reply", kind: "crashed" }
          : { kind: "reply", reply },
      );
    });
    port.onClose(() => {
      resolve(answerOfDisconnect(deps.lastError()));
    });
    port.post(request);
  });
  port.close();
  return answer;
};
