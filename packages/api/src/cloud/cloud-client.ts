// a refusal is a value, never a throw: the sync loop switches on the closed code, and an
// `Error("HTTP 409")` would retry a batch the server refuses forever. `unreachable` is no
// verdict on the credential; `malformed` is a body this build cannot read (an intercepting proxy).

import type { z } from "zod";
import {
  ACCOUNT_API_PATHS,
  accountResponseSchema,
  type AccountResponse,
} from "./account/account-schema";
import {
  ackCapturesResponseSchema,
  CAPTURE_API_PATHS,
  captureResponseSchema,
  claimCapturesResponseSchema,
  type AckCapturesRequest,
  type AckCapturesResponse,
  type CaptureRequest,
  type CaptureResponse,
  type ClaimCapturesResponse,
} from "./captures/captures-schema";
import { cloudErrorSchema, type CloudErrorCode } from "./cloud-errors";
import {
  DEVICE_API_PATHS,
  redeemDeviceResponseSchema,
  type RedeemDeviceRequest,
  type RedeemDeviceResponse,
} from "./pairing/pairing-schema";
import {
  pullResponseSchema,
  pushResponseSchema,
  SYNC_API_PATHS,
  type PullQuery,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from "./sync/sync-schema";
import type { DevicePlatform, SyncPing } from "./sync/sync-ws";
import {
  VAULT_API_PATHS,
  vaultFileResponseSchema,
  vaultTreeResponseSchema,
  type VaultAssetQuery,
  type VaultFileQuery,
  type VaultFileResponse,
  type VaultTreeQuery,
  type VaultTreeResponse,
} from "./vault/vault-schema";

export type CloudFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type CloudFailure =
  | { kind: "refused"; code: CloudErrorCode; message: string; deviceSeq: number | null }
  | { kind: "unreachable"; message: string }
  | { kind: "malformed"; message: string };

export type CloudResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; failure: CloudFailure };

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

function unreachable(cause: unknown): CloudFailure {
  return { kind: "unreachable", message: cause instanceof Error ? cause.message : String(cause) };
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

// every call runs inside the single-flight pass, so a black-holed request stalls the whole
// loop and the teardown waiting on it; undici's own default is 300s of headers timeout.
const REQUEST_TIMEOUT_MS = 30_000;

// undefined means GET; an undefined member is a key JSON.stringify drops
type JsonBody =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsonBody[]
  | { readonly [key: string]: JsonBody };

export interface CloudEndpoint {
  baseUrl: string;
  fetch?: CloudFetch;
  // composed with the per-request timeout, not replacing it: a shutdown must not wait out
  // a hung request, and a hung request must not wait for a shutdown
  signal?: AbortSignal;
}

function callSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

export function endpointUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function queryString(values: Record<string, string | number | undefined>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  const rendered = parameters.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

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
      signal: callSignal(endpoint.signal),
    });
  } catch (error) {
    return { ok: false, failure: unreachable(error) };
  }
  return await readValue(response, redeemDeviceResponseSchema);
}

export interface CloudClient {
  push(request: PushRequest): Promise<CloudResult<PushResponse>>;
  pull(query: PullQuery): Promise<CloudResult<PullResponse>>;
  createCapture(request: CaptureRequest): Promise<CloudResult<CaptureResponse>>;
  claimCaptures(limit: number): Promise<CloudResult<ClaimCapturesResponse>>;
  ackCaptures(request: AckCapturesRequest): Promise<CloudResult<AckCapturesResponse>>;
  account(): Promise<CloudResult<AccountResponse>>;
  vaultTree(query: VaultTreeQuery): Promise<CloudResult<VaultTreeResponse>>;
  vaultFile(query: VaultFileQuery): Promise<CloudResult<VaultFileResponse>>;
  // synchronous: the answer is bytes an <img> fetches itself; here so the bearer has one spelling
  vaultAssetSource(query: VaultAssetQuery): VaultAssetSource;
}

// the credential rides a header, never the URL, where image caches and logs would keep it
export interface VaultAssetSource {
  uri: string;
  headers: Record<string, string>;
}

export interface CreateCloudClientArgs extends CloudEndpoint {
  credential: string;
}

export function createCloudClient(args: CreateCloudClientArgs): CloudClient {
  const call = args.fetch ?? fetch;
  const authorization = `Bearer ${args.credential}`;

  async function send<TSchema extends z.ZodType>(
    path: string,
    json: JsonBody,
    schema: TSchema,
  ): Promise<CloudResult<z.infer<TSchema>>> {
    const signal = callSignal(args.signal);
    const init: RequestInit =
      json === undefined
        ? { method: "GET", headers: { authorization }, signal }
        : {
            method: "POST",
            headers: { authorization, "content-type": "application/json" },
            body: JSON.stringify(json),
            signal,
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
        `${SYNC_API_PATHS.pull}${queryString({ afterSeq: query.afterSeq, limit: query.limit })}`,
        undefined,
        pullResponseSchema,
      ),
    createCapture: (request) => send(CAPTURE_API_PATHS.capture, request, captureResponseSchema),
    claimCaptures: (limit) => send(CAPTURE_API_PATHS.claim, { limit }, claimCapturesResponseSchema),
    ackCaptures: (request) => send(CAPTURE_API_PATHS.ack, request, ackCapturesResponseSchema),
    account: () => send(ACCOUNT_API_PATHS.account, undefined, accountResponseSchema),
    vaultTree: (query) =>
      send(`${VAULT_API_PATHS.tree}${queryString(query)}`, undefined, vaultTreeResponseSchema),
    vaultFile: (query) =>
      send(`${VAULT_API_PATHS.file}${queryString(query)}`, undefined, vaultFileResponseSchema),
    vaultAssetSource: (query) => ({
      uri: endpointUrl(args.baseUrl, `${VAULT_API_PATHS.asset}${queryString(query)}`),
      headers: { authorization },
    }),
  };
}

// the socket dial is platform code: a browser-program import of a node dial types
// WebSocket as the DOM one, which takes no headers, and the bearer rides the upgrade.
export interface CloudSocket {
  close(): void;
}

export interface OpenCloudSocketArgs {
  baseUrl: string;
  credential: string;
  platform: DevicePlatform;
  onOpen(): void;
  onPing(ping: SyncPing): void;
  // called once even if the socket never opened; 1008 is a revoked device, never reconnect through it
  onClose(code: number): void;
}

export type CloudSocketOpener = (args: OpenCloudSocketArgs) => CloudSocket;
