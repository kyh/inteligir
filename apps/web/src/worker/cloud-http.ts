import { CLOUD_ERROR_STATUS, cloudError } from "@repo/api/cloud/errors";
import type { CloudErrorCode } from "@repo/api/cloud/errors";
import type { DeviceLoginResponse } from "@repo/api/cloud/device/device-schema";

export const refuse = (code: CloudErrorCode, message: string, deviceSeq?: number): Response =>
  Response.json(cloudError(code, message, deviceSeq), {
    status: CLOUD_ERROR_STATUS[code],
  });

// the one answer carrying a credential: no cache may keep it
export const jsonNoStore = (body: DeviceLoginResponse): Response =>
  Response.json(body, { headers: { "cache-control": "no-store" } });
