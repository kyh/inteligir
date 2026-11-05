// The site's side of connecting the browser extension: ask the extension whether it is in this
// browser, mint it a credential of its own for the signed-in account, hand it over, and revoke
// the credential again when the extension did not take it, so no device is left that nothing
// holds. The browser carries the messages (`externally_connectable`), to the one extension id the
// committed key names, never one a link could choose.

import {
  extensionConnectAnswerSchema,
  extensionConnectRequestSchema,
} from "@repo/contract/cloud/extension/extension-connect";
import type {
  ExtensionConnectAnswer,
  ExtensionConnectRequest,
} from "@repo/contract/cloud/extension/extension-connect";
import { EXTENSION_ID } from "@repo/contract/cloud/extension/extension-identity";
import type { DeviceLoginResponse } from "@repo/contract/cloud/device/device-schema";

export interface ConnectPorts {
  // the extension's answer, or null when no extension of that id answers in this browser
  readonly ask: (request: ExtensionConnectRequest) => Promise<ExtensionConnectAnswer | null>;
  // `account.connectExtension`, for the session this page is signed in with
  readonly mint: () => Promise<DeviceLoginResponse>;
  // `account.signOut` under the minted credential
  readonly revoke: (credential: string) => Promise<void>;
}

export type ConnectOutcome =
  | { readonly kind: "connected"; readonly email: string }
  | { readonly kind: "no-extension" }
  | { readonly kind: "not-taken" };

export const connectExtension = async (ports: ConnectPorts): Promise<ConnectOutcome> => {
  if ((await ports.ask({ type: "hello" })) === null) {
    return { kind: "no-extension" };
  }
  const connection = await ports.mint();
  const answer = await ports.ask({ connection, type: "connect" });
  if (answer?.email === connection.email) {
    return { email: connection.email, kind: "connected" };
  }
  // best effort: a revoke the cloud did not take leaves a device the devices page can revoke
  try {
    await ports.revoke(connection.credential);
  } catch {
    // the page says the extension did not take it either way
  }
  return { kind: "not-taken" };
};

type SendMessage = (extensionId: string, message: unknown) => Promise<unknown>;

// the messaging Chrome gives a page that an installed extension's `externally_connectable` names;
// a browser holding no such extension gives none
const pageSendMessage = (): SendMessage | null => {
  const chrome: unknown = Reflect.get(globalThis, "chrome");
  const runtime: unknown =
    typeof chrome === "object" && chrome !== null ? Reflect.get(chrome, "runtime") : undefined;
  const send: unknown =
    typeof runtime === "object" && runtime !== null
      ? Reflect.get(runtime, "sendMessage")
      : undefined;
  if (typeof send !== "function") {
    return null;
  }
  return async (extensionId, message) => {
    const sent: unknown = Reflect.apply(send, runtime, [extensionId, message]);
    return await sent;
  };
};

// a message to the extension, its answer parsed; no extension, a refused message or an answer
// that is not one all read as no answer
export const askExtension = async (
  request: ExtensionConnectRequest,
  send: SendMessage | null = pageSendMessage(),
): Promise<ExtensionConnectAnswer | null> => {
  if (send === null) {
    return null;
  }
  try {
    const answer = extensionConnectAnswerSchema.safeParse(
      await send(EXTENSION_ID, extensionConnectRequestSchema.parse(request)),
    );
    return answer.success ? answer.data : null;
  } catch {
    return null;
  }
};
