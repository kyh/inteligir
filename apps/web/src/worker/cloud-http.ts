import { CLOUD_ERROR_STATUS, cloudError, type CloudErrorCode } from "@repo/api/cloud/errors";
import type { DeviceLoginResponse } from "@repo/api/cloud/device/device-schema";

export function refuse(code: CloudErrorCode, message: string, deviceSeq?: number): Response {
  return Response.json(cloudError(code, message, deviceSeq), {
    status: CLOUD_ERROR_STATUS[code],
  });
}

// the one answer carrying a credential: no cache may keep it
export function jsonNoStore(body: DeviceLoginResponse): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
