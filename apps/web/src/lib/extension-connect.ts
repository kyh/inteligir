// The site's side of connecting the browser extension: tell the extension in this browser where the
// site is, and hear which account it found this browser signed in to here, which it saves to.
// Nothing crosses but the message, whose sender Chrome names by this page's origin; the extension
// reads the browser's own sign-in. The browser carries it (`externally_connectable`), to the one
// extension id the committed key names, never one a link could choose.

import {
  extensionConnectAnswerSchema,
  extensionConnectRequestSchema,
} from "@repo/contract/extension/extension-connect";
import type {
  ExtensionConnectAnswer,
  ExtensionConnectRequest,
} from "@repo/contract/extension/extension-connect";
import { EXTENSION_ID } from "@repo/contract/extension/extension-identity";
import type { JsonValue } from "@repo/contract/library/canonical-json";

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

export type ConnectOutcome =
  | { readonly kind: "connected"; readonly email: string }
  | { readonly kind: "no-extension" }
  // the extension answered, but found this browser signed in to no account here
  | { readonly kind: "no-sign-in" };

// no extension, a refused message or an answer that is not one all read as no answer
const askExtension = async (
  runtime: PageRuntime | undefined,
): Promise<ExtensionConnectAnswer | null> => {
  if (runtime === undefined) {
    return null;
  }
  try {
    const sent = await runtime.sendMessage(
      EXTENSION_ID,
      extensionConnectRequestSchema.parse({ type: "connect" }),
    );
    const answer = extensionConnectAnswerSchema.safeParse(sent);
    return answer.success ? answer.data : null;
  } catch {
    return null;
  }
};

export const tellExtension = async (runtime: PageRuntime | undefined): Promise<ConnectOutcome> => {
  const answer = await askExtension(runtime);
  if (answer === null) {
    return { kind: "no-extension" };
  }
  return answer.email === null
    ? { kind: "no-sign-in" }
    : { email: answer.email, kind: "connected" };
};
