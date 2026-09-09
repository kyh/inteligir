// a refusal is a value, never a throw: the sync loop switches on the closed code, and an
// `Error("HTTP 409")` would retry a batch the server refuses forever. `unreachable` is no
// verdict on the credential; `malformed` is a body this build cannot read (an intercepting proxy).

import type { z } from "zod";
import { ACCOUNT_API_PATHS, accountResponseSchema } from "./account/account-schema";
import type { AccountResponse } from "./account/account-schema";
import {
  ackCapturesResponseSchema,
  CAPTURE_API_PATHS,
  captureResponseSchema,
  claimCapturesResponseSchema,
} from "./captures/captures-schema";
import type {
  AckCapturesRequest,
  AckCapturesResponse,
  CaptureRequest,
  CaptureResponse,
  ClaimCapturesResponse,
} from "./captures/captures-schema";
import { cloudErrorSchema } from "./cloud-errors";
import type { CloudErrorCode } from "./cloud-errors";
import { DEVICE_API_PATHS, deviceLoginResponseSchema } from "./device/device-schema";
import type { DeviceLoginRequest, DeviceLoginResponse } from "./device/device-schema";
import { pullResponseSchema, pushResponseSchema, SYNC_API_PATHS } from "./sync/sync-schema";
import type { PullQuery, PullResponse, PushRequest, PushResponse } from "./sync/sync-schema";
import type { DevicePlatform, SyncPing } from "./sync/sync-ws";
import {
  VAULT_API_PATHS,
  vaultFileResponseSchema,
  vaultTreeResponseSchema,
} from "./vault/vault-schema";
import type {
  VaultAssetQuery,
  VaultFileQuery,
  VaultFileResponse,
  VaultTreeQuery,
  VaultTreeResponse,
} from "./vault/vault-schema";

export type CloudFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type CloudFailure =
  | { kind: "refused"; code: CloudErrorCode; message: string; deviceSeq: number | null }
  | { kind: "unreachable"; message: string }
  | { kind: "malformed"; message: string };

export type CloudResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; failure: CloudFailure };

export const describeCloudFailure = (failure: CloudFailure): string => {
  switch (failure.kind) {
    case "refused": {
      return failure.message;
    }
    case "unreachable": {
      return `Could not reach the cloud: ${failure.message}`;
    }
    case "malformed": {
      return failure.message;
    }
    // no default
  }
};

const unreachable = (cause: unknown): CloudFailure => ({
  kind: "unreachable",
  message: cause instanceof Error ? cause.message : String(cause),
});

const readFailure = async (response: Response): Promise<CloudFailure> => {
  const body: unknown = await response.json().catch(() => {
    /* empty */
  });
  const parsed = cloudErrorSchema.safeParse(body);
  if (!parsed.success) {
    return {
      kind: "malformed",
      message: `The cloud answered HTTP ${response.status} with a body this build cannot read.`,
    };
  }
  return {
    code: parsed.data.error.code,
    deviceSeq: parsed.data.error.deviceSeq ?? null,
    kind: "refused",
    message: parsed.data.error.message,
  };
};

const readValue = async <TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
): Promise<CloudResult<z.infer<TSchema>>> => {
  if (!response.ok) {
    return { failure: await readFailure(response), ok: false };
  }
  const body: unknown = await response.json().catch(() => {
    /* empty */
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      failure: {
        kind: "malformed",
        message: "The cloud answered 200 with a body this build cannot read.",
      },
      ok: false,
    };
  }
  return { ok: true, value: parsed.data };
};

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

const callSignal = (signal: AbortSignal | undefined): AbortSignal => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
};

export const endpointUrl = (baseUrl: string, path: string): string =>
  new URL(path, baseUrl).toString();

const queryString = (values: Record<string, string | number | undefined>): string => {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      parameters.set(key, String(value));
    }
  }
  const rendered = parameters.toString();
  return rendered === "" ? "" : `?${rendered}`;
};

// the one call made without a credential: its answer is the credential
export const postDeviceLogin = async (
  endpoint: CloudEndpoint,
  request: DeviceLoginRequest,
): Promise<CloudResult<DeviceLoginResponse>> => {
  const call = endpoint.fetch ?? fetch;
  let response: Response;
  try {
    response = await call(endpointUrl(endpoint.baseUrl, DEVICE_API_PATHS.login), {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: callSignal(endpoint.signal),
    });
  } catch (error) {
    return { failure: unreachable(error), ok: false };
  }
  return await readValue(response, deviceLoginResponseSchema);
};

export interface CloudClient {
  push: (request: PushRequest) => Promise<CloudResult<PushResponse>>;
  pull: (query: PullQuery) => Promise<CloudResult<PullResponse>>;
  createCapture: (request: CaptureRequest) => Promise<CloudResult<CaptureResponse>>;
  claimCaptures: (limit: number) => Promise<CloudResult<ClaimCapturesResponse>>;
  ackCaptures: (request: AckCapturesRequest) => Promise<CloudResult<AckCapturesResponse>>;
  account: () => Promise<CloudResult<AccountResponse>>;
  vaultTree: (query: VaultTreeQuery) => Promise<CloudResult<VaultTreeResponse>>;
  vaultFile: (query: VaultFileQuery) => Promise<CloudResult<VaultFileResponse>>;
  // synchronous: the answer is bytes an <img> fetches itself; here so the bearer has one spelling
  vaultAssetSource: (query: VaultAssetQuery) => VaultAssetSource;
}

// the credential rides a header, never the URL, where image caches and logs would keep it
export interface VaultAssetSource {
  uri: string;
  headers: Record<string, string>;
}

export interface CreateCloudClientArgs extends CloudEndpoint {
  credential: string;
}

export const createCloudClient = (args: CreateCloudClientArgs): CloudClient => {
  const call = args.fetch ?? fetch;
  const authorization = `Bearer ${args.credential}`;

  const send = async <TSchema extends z.ZodType>(
    path: string,
    json: JsonBody,
    schema: TSchema,
  ): Promise<CloudResult<z.infer<TSchema>>> => {
    const signal = callSignal(args.signal);
    const init: RequestInit =
      json === undefined
        ? { headers: { authorization }, method: "GET", signal }
        : {
            body: JSON.stringify(json),
            headers: { authorization, "content-type": "application/json" },
            method: "POST",
            signal,
          };
    let response: Response;
    try {
      response = await call(endpointUrl(args.baseUrl, path), init);
    } catch (error) {
      return { failure: unreachable(error), ok: false };
    }
    return await readValue(response, schema);
  };

  return {
    account: async () => await send(ACCOUNT_API_PATHS.account, undefined, accountResponseSchema),
    ackCaptures: async (request) =>
      await send(CAPTURE_API_PATHS.ack, request, ackCapturesResponseSchema),
    claimCaptures: async (limit) =>
      await send(CAPTURE_API_PATHS.claim, { limit }, claimCapturesResponseSchema),
    createCapture: async (request) =>
      await send(CAPTURE_API_PATHS.capture, request, captureResponseSchema),
    pull: async (query) =>
      await send(
        `${SYNC_API_PATHS.pull}${queryString({ afterSeq: query.afterSeq, limit: query.limit })}`,
        undefined,
        pullResponseSchema,
      ),
    push: async (request) => await send(SYNC_API_PATHS.push, request, pushResponseSchema),
    vaultAssetSource: (query) => ({
      headers: { authorization },
      uri: endpointUrl(args.baseUrl, `${VAULT_API_PATHS.asset}${queryString(query)}`),
    }),
    vaultFile: async (query) =>
      await send(
        `${VAULT_API_PATHS.file}${queryString(query)}`,
        undefined,
        vaultFileResponseSchema,
      ),
    vaultTree: async (query) =>
      await send(
        `${VAULT_API_PATHS.tree}${queryString(query)}`,
        undefined,
        vaultTreeResponseSchema,
      ),
  };
};

// the socket dial is platform code: a browser-program import of a node dial types
// WebSocket as the DOM one, which takes no headers, and the bearer rides the upgrade.
export interface CloudSocket {
  close: () => void;
}

export interface OpenCloudSocketArgs {
  baseUrl: string;
  credential: string;
  platform: DevicePlatform;
  onOpen: () => void;
  onPing: (ping: SyncPing) => void;
  // called once even if the socket never opened; 1008 is a revoked device, never reconnect through it
  onClose: (code: number) => void;
}

export type CloudSocketOpener = (args: OpenCloudSocketArgs) => CloudSocket;
