// The local cloud handlers. The runtime decides; this layer only turns what it
// decided into the contract's answer.
//
// There is no procedure here that takes a pairing CODE. Beginning an approval
// is the only pairing verb a client can call, and the code that eventually
// lands arrives at `GET /pair/callback` — a browser-facing route that is
// deliberately not a procedure (see `pair-callback.ts`).

import { base } from "../orpc";
import { pairCallbackUrlFor } from "./pair-callback";
import type { BeginPairArgs } from "./sync-runtime";

const status = base.cloud.status.handler(({ context }) => context.cloud.status());

const pairBegin = base.cloud.pairBegin.handler(({ context, input, errors }) => {
  // The address the browser will be sent back to, named by the port the CALLER
  // actually reached — `listen` may probe past a busy dev port, so the
  // configured number is a guess. `pairCallbackUrlFor` stays the one gate: the
  // composed URL is judged by the contract's own allowlist, the same one the
  // approve page applies.
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
