// no procedure takes a pairing code: it lands on GET /pair/callback, a browser
// route outside the contract table.

import { base } from "../orpc";
import { pairCallbackUrlFor } from "./pair-callback";
import type { BeginPairArgs } from "./pair-flow";

const status = base.cloud.status.handler(({ context }) => context.cloud.status());

const pairBegin = base.cloud.pairBegin.handler(({ context, input, errors }) => {
  // the port the caller reached, not the configured one — listen may probe past a busy dev port.
  const callbackUrl = pairCallbackUrlFor(context.requestHost);
  if (callbackUrl === null) {
    throw errors.BAD_REQUEST({
      message: "Pairing must be started from this app's own address (127.0.0.1 or localhost).",
    });
  }
  const begin: BeginPairArgs = { callbackUrl, openBrowser: input.openBrowser };
  if (input.deviceName !== undefined) begin.deviceName = input.deviceName;
  return context.cloud.beginPair(begin);
});

const unpair = base.cloud.unpair.handler(({ context }) => context.cloud.unpair());

const syncNow = base.cloud.syncNow.handler(({ context }) => context.cloud.syncNow());

export const cloudRouter = {
  status,
  pairBegin,
  unpair,
  syncNow,
};
