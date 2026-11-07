// The extension's own device credential and the cloud it was handed from, kept in
// `storage.local`, which the worker opens to the extension's own pages and itself alone
// (`TRUSTED_CONTEXTS`, set as it starts), never to the capture script it injects into a page. The
// site's connect page hands it over (`answerConnectPage`), its sender checked and its message
// parsed by the listener first; a credential it replaces or lets go is revoked by this device,
// best-effort and never waited on, since an unreachable cloud must not hold a disconnect open.

import { CONNECT_EXTENSION_PATH } from "@repo/contract/cloud/extension/extension-connect";
import type {
  ExtensionConnectAnswer,
  ExtensionConnectRequest,
} from "@repo/contract/cloud/extension/extension-connect";
import { deviceLoginResponseSchema } from "@repo/contract/cloud/device/device-schema";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";
import { browser } from "wxt/browser";
import { z } from "zod";

import type { ExtensionFlavor } from "../manifest";

const CONNECTION_KEY = "connection";

// what a connect handed over, and the origin of the page that handed it, which is the cloud every
// call goes to
const connectionSchema = z.strictObject({
  ...deviceLoginResponseSchema.shape,
  origin: z.string().min(1),
});
export type Connection = z.infer<typeof connectionSchema>;

// a record that does not parse reads as no connection, never as a credential every call refuses
export const readConnection = async (): Promise<Connection | null> => {
  const stored = await browser.storage.local.get(CONNECTION_KEY);
  const parsed = connectionSchema.safeParse(stored[CONNECTION_KEY]);
  return parsed.success ? parsed.data : null;
};

const keepConnection = async (connection: Connection): Promise<void> => {
  await browser.storage.local.set({ [CONNECTION_KEY]: connection });
};

export const forgetConnection = async (): Promise<void> => {
  await browser.storage.local.remove(CONNECTION_KEY);
};

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
  // a credential this extension lets go, revoked at the cloud it came from
  readonly revoke: (connection: Connection) => Promise<void>;
}

// a revoke the cloud did not take leaves a device the devices page can revoke
export const revokeQuietly = async (deps: ConnectDeps, connection: Connection): Promise<void> => {
  try {
    await deps.revoke(connection);
  } catch {
    // nothing to say: this device has let it go either way
  }
};

// the connect page's hello or its hand-over, from the page at `origin`: a hello connects no
// account, and a hand-over answers the one the extension now saves to
export const answerConnectPage = async (
  request: ExtensionConnectRequest,
  origin: string,
  deps: ConnectDeps,
): Promise<ExtensionConnectAnswer> => {
  if (request.type === "hello") {
    return { email: null };
  }
  const held = await readConnection();
  await keepConnection({ ...request.connection, origin });
  if (held !== null && held.credential !== request.connection.credential) {
    void revokeQuietly(deps, held);
  }
  return { email: request.connection.email };
};
