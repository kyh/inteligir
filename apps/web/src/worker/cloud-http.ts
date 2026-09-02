import { CLOUD_ERROR_STATUS, cloudError, type CloudErrorCode } from "@repo/api/cloud/errors";
import type {
  MintPairingCodeResponse,
  RedeemDeviceResponse,
} from "@repo/api/cloud/pairing/pairing-schema";

export function refuse(code: CloudErrorCode, message: string, deviceSeq?: number): Response {
  return Response.json(cloudError(code, message, deviceSeq), {
    status: CLOUD_ERROR_STATUS[code],
  });
}

type NoStoreBody = MintPairingCodeResponse | RedeemDeviceResponse;

export function jsonNoStore(body: NoStoreBody): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
