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
import type { JsonValue } from "@repo/notes/library/canonical-json";

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

// the messaging Chrome gives a page that an installed extension's `externally_connectable` names:
// a message crosses as JSON, and an answer of none as undefined; what the extension answers is
// the extension's to say, so it is parsed before anything reads it
interface PageRuntime {
  readonly sendMessage: (
    extensionId: string,
    message: ExtensionConnectRequest,
  ) => Promise<JsonValue | undefined>;
}

declare global {
  interface Window {
    // none in a browser holding no such extension
    readonly chrome?: { readonly runtime?: PageRuntime };
  }
}

// a message to the extension, its answer parsed; no extension, a refused message or an answer
// that is not one all read as no answer
export const askExtension = async (
  runtime: PageRuntime | undefined,
  request: ExtensionConnectRequest,
): Promise<ExtensionConnectAnswer | null> => {
  if (runtime === undefined) {
    return null;
  }
  try {
    const sent = await runtime.sendMessage(
      EXTENSION_ID,
      extensionConnectRequestSchema.parse(request),
    );
    const answer = extensionConnectAnswerSchema.safeParse(sent);
    return answer.success ? answer.data : null;
  } catch {
    return null;
  }
};
