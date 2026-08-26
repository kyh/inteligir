import { CLOUD_ERROR_STATUS, cloudError, type CloudErrorCode } from "@repo/api/cloud/errors";
import type {
  MintPairingCodeResponse,
  RedeemDeviceResponse,
} from "@repo/api/cloud/pairing/pairing-schema";

// ---------------------------------------------------------------------------
// The one place a cloud-contract refusal becomes an HTTP response, so every
// route answers the same envelope and no route invents a status for a code.
// ---------------------------------------------------------------------------

/** `deviceSeq` is carried only by the two sync codes, which name the outbox
 * position that disagreed (see the contract's errors module). */
export function refuse(code: CloudErrorCode, message: string, deviceSeq?: number): Response {
  return Response.json(cloudError(code, message, deviceSeq), {
    status: CLOUD_ERROR_STATUS[code],
  });
}

/** Every body this Worker answers with `no-store`, which is exactly the set
 *  that carries a credential or a one-time code. */
type NoStoreBody = MintPairingCodeResponse | RedeemDeviceResponse;

/** For responses that carry a credential or a code — never cacheable. */
export function jsonNoStore(body: NoStoreBody): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
