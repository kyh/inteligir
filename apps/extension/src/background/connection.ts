// The cloud this browser saves to and the account last read signed in there, kept in
// `storage.local`, which the worker opens to the extension's own pages and itself alone
// (`TRUSTED_CONTEXTS`, set as it starts), never to the capture script it injects into a page. It
// holds no credential: the session is the browser's own (./sign-in). The site's connect page names
// the cloud (`answerConnectPage`), its sender checked and its message parsed by the listener first.

import { CONNECT_EXTENSION_PATH } from "@repo/contract/extension/extension-connect";
import type { ExtensionConnectAnswer } from "@repo/contract/extension/extension-connect";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/origin";
import { browser } from "wxt/browser";
import { z } from "zod";

import { DEV_CLOUD_ORIGIN } from "../manifest";
import type { ExtensionFlavor } from "../manifest";
import type { SignIn } from "./sign-in";

const CONNECTION_KEY = "connection";

// the account a save made signed out waits for, and the cloud every call goes to
const connectionSchema = z.strictObject({
  email: z.string().min(1),
  origin: z.string().min(1),
});
export type Connection = z.infer<typeof connectionSchema>;

// a record that does not parse reads as no connection
export const readConnection = async (): Promise<Connection | null> => {
  const stored = await browser.storage.local.get(CONNECTION_KEY);
  const parsed = connectionSchema.safeParse(stored[CONNECTION_KEY]);
  return parsed.success ? parsed.data : null;
};

export const keepConnection = async (connection: Connection): Promise<void> => {
  await browser.storage.local.set({ [CONNECTION_KEY]: connection });
};

export const forgetConnection = async (): Promise<void> => {
  await browser.storage.local.remove(CONNECTION_KEY);
};

// the cloud this build saves to before a connect page names one: the production site, or for the
// dev build the local Worker `pnpm dev:web` serves. The mode is a literal in the bundle, so a store
// build carries no checkout's origin (the zip's check in wxt.config.ts)
const FIRST_CLOUD_ORIGIN =
  import.meta.env.MODE === "store" ? PRODUCTION_CLOUD_ORIGIN : DEV_CLOUD_ORIGIN;

export const cloudOrigin = (connection: Connection | null): string =>
  connection?.origin ?? FIRST_CLOUD_ORIGIN;

// the fields of Chrome's MessageSender this reads
export interface ConnectSender {
  readonly origin?: string | undefined;
  readonly url?: string | undefined;
}

// the connect page of the cloud this build may be connected to, and no other page: the production
// site's origin exactly, or, for the dev build, a local Worker's on any port
export const connectPageOrigin = (
  flavor: ExtensionFlavor,
  sender: ConnectSender,
): string | null => {
  if (sender.origin === undefined || sender.url === undefined) {
    return null;
  }
  let page: URL;
  try {
    page = new URL(sender.url);
  } catch {
    return null;
  }
  if (page.origin !== sender.origin || page.pathname !== CONNECT_EXTENSION_PATH) {
    return null;
  }
  const allowed =
    flavor === "dev"
      ? page.protocol === "http:" && page.hostname === "localhost"
      : sender.origin === PRODUCTION_CLOUD_ORIGIN;
  return allowed ? sender.origin : null;
};

export interface ConnectDeps {
  // the cloud at `origin` asked whose session the browser holds there, the account it names kept
  // as this browser's; null when it did not answer
  readonly signIn: (origin: string) => Promise<SignIn | null>;
}

// a message from the connect page at `origin`, which the listener parsed: the account the browser
// is signed in as there, which the extension now saves to, or none. The message itself carries
// nothing the answer reads
export const answerConnectPage = async (
  origin: string,
  deps: ConnectDeps,
): Promise<ExtensionConnectAnswer> => {
  const signIn = await deps.signIn(origin);
  return { email: signIn?.kind === "signed-in" ? signIn.session.email : null };
};
