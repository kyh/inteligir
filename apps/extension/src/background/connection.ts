// The cloud this build saves to and the account last read signed in there. The account is kept in
// `storage.local`, which the worker opens to the extension's own pages and itself alone
// (`TRUSTED_CONTEXTS`, set as it starts), never to the capture script it injects into a page. It
// holds no credential: the session is the browser's own (./sign-in).

import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/origin";
import { browser } from "wxt/browser";
import { z } from "zod";

import { DEV_CLOUD_ORIGIN } from "../manifest";

const CONNECTION_KEY = "connection";

// the account a save made signed out waits for
const connectionSchema = z.strictObject({ email: z.string().min(1) });
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

// where a dev build's storage names a local Worker other than `pnpm dev:web`'s, as the e2e does
// for the one it boots on a port of its own; the dev manifest's host reaches no other cloud
const DEV_CLOUD_KEY = "cloud-origin";

// the schema is built in the call, since one built as the module loads stays in a store bundle
const devCloudOrigin = async (): Promise<string> => {
  const stored = await browser.storage.local.get(DEV_CLOUD_KEY);
  const named = z
    .string()
    .regex(/^http:\/\/localhost:\d+$/u)
    .safeParse(stored[DEV_CLOUD_KEY]);
  return named.success ? named.data : DEV_CLOUD_ORIGIN;
};

// a store build's cloud is the production site, which nothing moves. The mode is a literal in the
// bundle, so that build carries no checkout's origin and no read of one (the zip's check in
// wxt.config.ts)
export const cloudOrigin = async (): Promise<string> =>
  import.meta.env.MODE === "store" ? PRODUCTION_CLOUD_ORIGIN : await devCloudOrigin();
