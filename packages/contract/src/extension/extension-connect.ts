// The site's /connect/extension page and the browser extension, over `externally_connectable`:
// the page tells the extension in this browser where the site is, and the extension answers the
// account this browser is signed in to there, which it saves to. No credential crosses: the
// extension reads the browser's own sign-in. Chrome lets only the pages the manifest's
// `externally_connectable.matches` names send these, and the extension checks each sender's
// origin before it reads one; both ends parse, since a message crosses as an untyped value.

import { z } from "zod";

export const extensionConnectRequestSchema = z.strictObject({ type: z.literal("connect") });
export type ExtensionConnectRequest = z.infer<typeof extensionConnectRequestSchema>;

// the account the extension found this browser signed in to at the page's origin, or none; any
// answer says the extension is in this browser
export const extensionConnectAnswerSchema = z.object({ email: z.string().min(1).nullable() });
export type ExtensionConnectAnswer = z.infer<typeof extensionConnectAnswerSchema>;

// the site's page that connects the extension, the one page its manifest lets message it
export const CONNECT_EXTENSION_PATH = "/connect/extension";
