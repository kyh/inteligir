import { cloudError, type CloudErrorCode } from "@repo/api/cloud/errors";
import type {
  MintPairingCodeResponse,
  RedeemDeviceResponse,
} from "@repo/api/cloud/pairing/pairing-schema";

// ---------------------------------------------------------------------------
// The one place a cloud-contract refusal becomes an HTTP response, so every
// route answers the same envelope and no route invents a status for a code.
// ---------------------------------------------------------------------------

const STATUS_BY_CODE = {
  "bad-request": 400,
  unauthorized: 401,
  "not-found": 404,
  "rate-limited": 429,
  "invalid-code": 404,
  "code-expired": 410,
  "code-consumed": 409,
  "device-limit": 409,
  "sync-conflict": 409,
  "sync-out-of-order": 409,
  // Gone, not 401: the credential was fine, the account it named is not — a
  // client told "unauthorized" retries the credential forever.
  "account-deleted": 410,
  internal: 500,
} satisfies Record<CloudErrorCode, number>;

/** `deviceSeq` is carried only by the two sync codes, which name the outbox
 * position that disagreed (see the contract's errors module). */
export function refuse(code: CloudErrorCode, message: string, deviceSeq?: number): Response {
  return Response.json(cloudError(code, message, deviceSeq), { status: STATUS_BY_CODE[code] });
}

/** Every body this Worker answers with `no-store`, which is exactly the set
 *  that carries a credential or a one-time code. */
type NoStoreBody = MintPairingCodeResponse | RedeemDeviceResponse;

/** For responses that carry a credential or a code — never cacheable. */
export function jsonNoStore(body: NoStoreBody): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
