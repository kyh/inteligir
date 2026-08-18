// The typed face over the cloud Worker: `@repo/cloud-contract`'s paths and
// schemas, the bearer, and the ONE thing this file exists to get right — a
// refusal is a VALUE, never a thrown string.
//
// The contract ships a closed error enum precisely so the app can switch on
// it, and the sync loop's whole behaviour hangs off that switch: `unauthorized`
// stops the runtime, `sync-conflict` and `sync-out-of-order` mean this
// device's own outbox is wrong (and name the position), everything else is
// worth one more attempt later. A client that turned all three into
// `Error("HTTP 409")` would leave the runtime retrying a batch the server will
// refuse forever.
//
// Three failure kinds, not one, because the callers differ: a REFUSED call
// carries the server's judgement, an UNREACHABLE one carries no judgement at
// all (offline, a captive portal) and must not be read as a verdict on the
// credential, and a MALFORMED answer is a body this build cannot read — which
// is what a proxy that intercepted the request looks like.

import {
  ackCapturesResponseSchema,
  CAPTURE_API_PATHS,
  claimCapturesResponseSchema,
  type AckCapturesRequest,
  type AckCapturesResponse,
  type ClaimCapturesResponse,
} from "@repo/cloud-contract/captures";
import { cloudErrorSchema, type CloudErrorCode } from "@repo/cloud-contract/errors";
import {
  DEVICE_API_PATHS,
  redeemDeviceResponseSchema,
  type RedeemDeviceRequest,
  type RedeemDeviceResponse,
} from "@repo/cloud-contract/pairing";
import {
  pullResponseSchema,
  pushResponseSchema,
  SYNC_API_PATHS,
  type PullQuery,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from "@repo/cloud-contract/sync";
import type { DevicePlatform, SyncPing } from "@repo/cloud-contract/ws";
import type { z } from "zod";

/** Narrower than `globalThis.fetch` on purpose: this module only ever dials a
 *  string URL, and the narrow shape is what a test double has to implement. */
export type CloudFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type CloudFailure =
  | { kind: "refused"; code: CloudErrorCode; message: string; deviceSeq: number | null }
  | { kind: "unreachable"; message: string }
  | { kind: "malformed"; message: string };

export type CloudResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; failure: CloudFailure };

/** One sentence for a status line — the local UI renders this, so it says what
 *  happened rather than which layer noticed. */
export function describeCloudFailure(failure: CloudFailure): string {
  switch (failure.kind) {
    case "refused":
      return failure.message;
    case "unreachable":
      return `Could not reach the cloud: ${failure.message}`;
    case "malformed":
      return failure.message;
  }
}

function unreachable(error: unknown): CloudFailure {
  return { kind: "unreachable", message: error instanceof Error ? error.message : String(error) };
}

async function readFailure(response: Response): Promise<CloudFailure> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = cloudErrorSchema.safeParse(body);
  if (!parsed.success) {
    return {
      kind: "malformed",
      message: `The cloud answered HTTP ${response.status} with a body this build cannot read.`,
    };
  }
  return {
    kind: "refused",
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    deviceSeq: parsed.data.error.deviceSeq ?? null,
  };
}

async function readValue<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
): Promise<CloudResult<z.infer<TSchema>>> {
  if (!response.ok) {
    return { ok: false, failure: await readFailure(response) };
  }
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        kind: "malformed",
        message: "The cloud answered 200 with a body this build cannot read.",
      },
    };
  }
  return { ok: true, value: parsed.data };
}

export interface CloudEndpoint {
  /** Origin of the cloud deployment, e.g. `https://inteligir.com`. */
  baseUrl: string;
  /** Injected so a suite can drive the whole runtime without a network. */
  fetch?: CloudFetch;
}

function endpointUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

/**
 * Exchange a pairing code for the durable credential. The only unauthenticated
 * call this app makes — the code IS the credential here, which is why it is
 * short-lived and rate-limited on the far side.
 */
export async function redeemDevice(
  endpoint: CloudEndpoint,
  request: RedeemDeviceRequest,
): Promise<CloudResult<RedeemDeviceResponse>> {
  const call = endpoint.fetch ?? fetch;
  let response: Response;
  try {
    response = await call(endpointUrl(endpoint.baseUrl, DEVICE_API_PATHS.redeem), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    return { ok: false, failure: unreachable(error) };
  }
  return await readValue(response, redeemDeviceResponseSchema);
}

export interface CloudClient {
  push(request: PushRequest): Promise<CloudResult<PushResponse>>;
  pull(query: PullQuery): Promise<CloudResult<PullResponse>>;
  claimCaptures(limit: number): Promise<CloudResult<ClaimCapturesResponse>>;
  ackCaptures(request: AckCapturesRequest): Promise<CloudResult<AckCapturesResponse>>;
}

export interface CreateCloudClientArgs extends CloudEndpoint {
  credential: string;
}

export function createCloudClient(args: CreateCloudClientArgs): CloudClient {
  const call = args.fetch ?? fetch;
  const authorization = `Bearer ${args.credential}`;

  /** `json` present means POST with a body; absent means GET. The headers are
   *  built here rather than merged from a caller's `RequestInit`, so the
   *  bearer can never be dropped by one that passed its own header list. */
  async function send<TSchema extends z.ZodType>(
    path: string,
    json: unknown,
    schema: TSchema,
  ): Promise<CloudResult<z.infer<TSchema>>> {
    const init: RequestInit =
      json === undefined
        ? { method: "GET", headers: { authorization } }
        : {
            method: "POST",
            headers: { authorization, "content-type": "application/json" },
            body: JSON.stringify(json),
          };
    let response: Response;
    try {
      response = await call(endpointUrl(args.baseUrl, path), init);
    } catch (error) {
      return { ok: false, failure: unreachable(error) };
    }
    return await readValue(response, schema);
  }

  return {
    push: (request) => send(SYNC_API_PATHS.push, request, pushResponseSchema),
    pull: (query) =>
      send(
        `${SYNC_API_PATHS.pull}?afterSeq=${query.afterSeq}&limit=${query.limit}`,
        undefined,
        pullResponseSchema,
      ),
    claimCaptures: (limit) => send(CAPTURE_API_PATHS.claim, { limit }, claimCapturesResponseSchema),
    ackCaptures: (request) => send(CAPTURE_API_PATHS.ack, request, ackCapturesResponseSchema),
  };
}

// -- the invalidation socket ------------------------------------------------
//
// Only its SHAPE lives here. The dial itself is `cloud-socket.ts`, imported by
// `main.ts` alone, and the split is not taste: a UI test harness imports the
// node test harness, which drags every module reachable from `app.ts` into the
// browser tsconfig's program — where `WebSocket` is the DOM one and takes no
// headers. Moving the dial out of that graph is what keeps `Authorization` on
// the upgrade, which is the whole reason the contract needs no ticket.

export interface CloudSocket {
  close(): void;
}

export interface OpenCloudSocketArgs {
  baseUrl: string;
  credential: string;
  platform: DevicePlatform;
  onOpen(): void;
  onPing(ping: SyncPing): void;
  /** Called once, whether the socket closed cleanly or never opened. `code`
   *  1008 is the server severing a revoked device — the one close the runtime
   *  must not reconnect through. */
  onClose(code: number): void;
}

/** How the socket is dialled — injected so a suite can exercise reconnect and
 *  ping handling without a network. */
export type CloudSocketOpener = (args: OpenCloudSocketArgs) => CloudSocket;
