// ---------------------------------------------------------------------------
// The coordinator's device-identity routes, as three calls.
//
// Sibling of `HttpSyncPort` (which owns manifest/file/changes) rather than part
// of it: these are roster ADMINISTRATION, driven by a settings panel, and the
// sync engine must never acquire a way to enroll or revoke a key as a side
// effect of a pass.
//
// Every response is parsed at the boundary into a typed value and every failure
// — transport, HTTP status, malformed body — comes back as `{ok:false}` with
// text a settings panel can render. A 401 is the one worth reading: its body
// carries the assertion rejection, and `assertion-expired` means "check this
// device's clock", not "sign in again". There is no sign-in to offer.
// ---------------------------------------------------------------------------

import { isRecord } from "@repo/notes/sync/guards";
import {
  devicesPath,
  enrollOfferPath,
  formatBearer,
  HEADER_AUTHORIZATION,
  revokePath,
  type DeviceRecord,
  type EnrollOfferRequest,
  type RevokeResponse,
} from "@repo/notes/sync/wire";

/** What every call here needs: where the coordinator is, which vault, and a
 * freshly minted assertion per request. */
export type DeviceApi = {
  readonly baseUrl: string;
  readonly vaultId: string;
  readonly getToken: () => Promise<string>;
};

export type DeviceApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** `GET …/devices` — the roster, tombstones included. */
export async function fetchDeviceRoster(
  api: DeviceApi,
): Promise<DeviceApiResult<readonly DeviceRecord[]>> {
  return request(api, devicesPath(api.vaultId), "GET", undefined, (raw) => {
    if (!isRecord(raw) || !Array.isArray(raw.devices)) return null;
    const devices: DeviceRecord[] = [];
    for (const entry of raw.devices) {
      const record = parseDeviceRecord(entry);
      if (record === null) return null;
      devices.push(record);
    }
    return devices;
  });
}

/** `POST …/enroll-offer` — deposit the HASH of a pairing secret. Returns the
 * expiry the coordinator actually granted (it clamps to its own maximum). */
export async function postEnrollOffer(
  api: DeviceApi,
  body: EnrollOfferRequest,
): Promise<DeviceApiResult<number>> {
  return request(api, enrollOfferPath(api.vaultId), "POST", body, (raw) =>
    isRecord(raw) && typeof raw.notAfter === "number" ? raw.notAfter : null,
  );
}

/** `POST …/revoke` — tombstone one key. A `last-device` refusal is a VALUE the
 * caller renders as "disconnect this vault", not an error to retry. */
export async function postRevoke(
  api: DeviceApi,
  publicKey: string,
): Promise<DeviceApiResult<RevokeResponse>> {
  return request(api, revokePath(api.vaultId), "POST", { publicKey }, parseRevokeResponse);
}

// ---- internals ------------------------------------------------------------

async function request<T>(
  api: DeviceApi,
  routePath: string,
  method: "GET" | "POST",
  body: unknown,
  parse: (raw: unknown) => T | null,
): Promise<DeviceApiResult<T>> {
  let response: Response;
  try {
    const headers: Record<string, string> = {
      [HEADER_AUTHORIZATION]: formatBearer(await api.getToken()),
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    response = await fetch(`${api.baseUrl.replace(/\/+$/, "")}${routePath}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The server is unreachable." };
  }
  if (!response.ok) return { ok: false, error: await describeFailure(response) };
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { ok: false, error: "The server returned a malformed response." };
  }
  const value = parse(raw);
  return value === null
    ? { ok: false, error: "The server returned a malformed response." }
    : { ok: true, value };
}

/** A 401's body is the assertion rejection; anything else is a plain status. */
async function describeFailure(response: Response): Promise<string> {
  if (response.status !== 401) return `The server refused the request (HTTP ${response.status}).`;
  const reason = await response.text().catch(() => "");
  if (reason.startsWith("assertion-")) {
    return `This device's credential was refused (${reason}). Check that its clock is correct.`;
  }
  return "This device's credential was refused by the server.";
}

function parseDeviceRecord(raw: unknown): DeviceRecord | null {
  if (!isRecord(raw)) return null;
  const { publicKey, name, enrolledAt, revokedAt } = raw;
  if (typeof publicKey !== "string" || publicKey === "") return null;
  if (typeof name !== "string") return null;
  if (typeof enrolledAt !== "number") return null;
  if (revokedAt !== null && typeof revokedAt !== "number") return null;
  return { publicKey, name, enrolledAt, revokedAt };
}

function parseRevokeResponse(raw: unknown): RevokeResponse | null {
  if (!isRecord(raw)) return null;
  if (raw.ok === true && typeof raw.revokedAt === "number") {
    return { ok: true, revokedAt: raw.revokedAt };
  }
  if (raw.ok === false && (raw.reason === "not-found" || raw.reason === "last-device")) {
    return { ok: false, reason: raw.reason };
  }
  return null;
}
