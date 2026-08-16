import { cloudError, type CloudErrorCode } from "@repo/cloud-contract/errors";

// ---------------------------------------------------------------------------
// The one place a cloud-contract refusal becomes an HTTP response, so every
// route answers the same envelope and no route invents a status for a code.
// ---------------------------------------------------------------------------

const STATUS_BY_CODE: Record<CloudErrorCode, number> = {
  "bad-request": 400,
  unauthorized: 401,
  "not-found": 404,
  "rate-limited": 429,
  "invalid-code": 404,
  "code-expired": 410,
  "code-consumed": 409,
  "device-limit": 409,
  "artifacts-not-enabled": 503,
  internal: 500,
};

export function refuse(code: CloudErrorCode, message: string): Response {
  return Response.json(cloudError(code, message), { status: STATUS_BY_CODE[code] });
}

/** For responses that carry a credential or a code — never cacheable. */
export function jsonNoStore(body: unknown): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
