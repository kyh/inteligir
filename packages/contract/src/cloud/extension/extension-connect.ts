// The site's /connect/extension page and the browser extension, over `externally_connectable`:
// the page asks whether the extension is in this browser and which account it saves to, then hands
// it the credential `account.connectExtension` minted for the signed-in account. Chrome lets only
// the pages the manifest's `externally_connectable.matches` names send these, and the extension
// checks each sender's origin before it reads one; both ends parse, since a message crosses as an
// untyped value.

import { z } from "zod";

import { deviceLoginResponseSchema } from "../device/device-schema";

export const extensionConnectRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello") }),
  z.strictObject({ connection: deviceLoginResponseSchema, type: z.literal("connect") }),
]);
export type ExtensionConnectRequest = z.infer<typeof extensionConnectRequestSchema>;

// the account whose library the extension saves to once it has read the message, or none
export const extensionConnectAnswerSchema = z.object({ email: z.string().min(1).nullable() });
export type ExtensionConnectAnswer = z.infer<typeof extensionConnectAnswerSchema>;

// the site's page that connects the extension, the one page its manifest lets message it
export const CONNECT_EXTENSION_PATH = "/connect/extension";
