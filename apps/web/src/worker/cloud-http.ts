import { CLOUD_ERROR_STATUS, cloudError } from "@repo/api/cloud/errors";
import type { CloudErrorCode } from "@repo/api/cloud/errors";
import type { DeviceLoginResponse } from "@repo/api/cloud/device/device-schema";

export const refuse = (code: CloudErrorCode, message: string, deviceSeq?: number): Response =>
  Response.json(cloudError(code, message, deviceSeq), {
    status: CLOUD_ERROR_STATUS[code],
  });

// NaN when undeclared, never 0: Number("") is 0, so an absent header would read as a tiny body
export const declaredLength = (headers: Headers): number => {
  const header = headers.get("content-length") ?? "";
  return /^\d+$/u.test(header) ? Number(header) : Number.NaN;
};

// the one answer carrying a credential: no cache may keep it
export const jsonNoStore = (body: DeviceLoginResponse): Response =>
  Response.json(body, { headers: { "cache-control": "no-store" } });
