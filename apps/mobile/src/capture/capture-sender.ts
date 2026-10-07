import type {
  CaptureRequest,
  CaptureResponse,
} from "@repo/contract/cloud/captures/captures-schema";
import type { CloudResult } from "@repo/contract/cloud/client";

export interface CaptureSenderArgs {
  send: (request: CaptureRequest) => Promise<CloudResult<CaptureResponse>>;
  mintKey: () => string;
}

export type CaptureSender = (text: string) => Promise<CloudResult<CaptureResponse>>;

// a failed send may still have landed (the response was lost, not the request), so the retry of
// the same words must carry the same key for the cloud to answer `duplicate` rather than store a
// second capture. edited words are a different capture and take a new key.
export const createCaptureSender = (args: CaptureSenderArgs): CaptureSender => {
  let pending: CaptureRequest | null = null;
  return async (text) => {
    if (pending === null || pending.text !== text) {
      pending = { idempotencyKey: args.mintKey(), text };
    }
    const request = pending;
    const result = await args.send(request);
    if (result.ok && pending === request) {
      pending = null;
    }
    return result;
  };
};
