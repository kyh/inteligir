// The local cloud procedures: read this install's relationship with an account,
// and the three verbs that change it.
//
// `GET /pair/callback` is deliberately NOT here. It answers HTML to a browser
// arriving from the approve page, so it stays a plain HTTP route beside /ws.

import { oc } from "@orpc/contract";
import {
  cloudPairBeginRequestSchema,
  cloudPairBeginResponseSchema,
  cloudStatusResponseSchema,
} from "./cloud-schema";

export const cloudContract = {
  status: oc.output(cloudStatusResponseSchema),

  /**
   * Start a browser-approve pairing: mint a single-use `state`, compose the
   * approve page's URL, and optionally open it.
   *
   * There is no procedure here that takes a CODE, and that absence is the
   * design. The code still exists — it is what the approve page mints and the
   * redirect carries — but nothing human-facing shows one or accepts one, so
   * the only caller that can complete a pairing is a browser arriving at
   * `GET /pair/callback` with a `state` this procedure handed out.
   *
   * The one refusal is a request that did not reach this server over its own
   * loopback origin: it names no callback address, so it is a bad request.
   */
  pairBegin: oc
    .input(cloudPairBeginRequestSchema)
    .output(cloudPairBeginResponseSchema)
    .errors({ BAD_REQUEST: {} }),

  /** Idempotent: unpairing an install that was never paired answers `off`.
   *  This end only forgets the credential — the device row on the account
   *  survives until it is revoked there, which is where the audit trail is. */
  unpair: oc.output(cloudStatusResponseSchema),

  /** Run a full pass now — drain, pull, apply, captures — and answer the state
   *  it left behind. A refusal along the way is reported in `lastError` rather
   *  than as a status: the pass is best-effort by construction, and a caller
   *  that asked for one wants to know where it got to. */
  syncNow: oc.output(cloudStatusResponseSchema),
};
