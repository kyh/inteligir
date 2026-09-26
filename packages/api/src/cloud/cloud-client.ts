// a refusal is a value, never a throw: the sync loop switches on the closed code, and an
// `Error("HTTP 409")` would retry a batch the server refuses forever. `unreachable` is no
// verdict on the credential; `malformed` is a body this build cannot read (an intercepting proxy).

import type { z } from "zod";
import {
  ACCOUNT_API_PATHS,
  accountResponseSchema,
  deleteAccountResponseSchema,
} from "./account/account-schema";
import type {
  AccountResponse,
  DeleteAccountRequest,
  DeleteAccountResponse,
  DeviceSignUpRequest,
} from "./account/account-schema";
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
import type { CloudError, CloudErrorCode } from "./cloud-errors";
import {
  DEVICE_API_PATHS,
  deviceLoginResponseSchema,
  listDevicesResponseSchema,
  revokeDeviceResponseSchema,
} from "./device/device-schema";
import type {
  DeviceLoginRequest,
  DeviceLoginResponse,
  ListDevicesResponse,
  RevokeDeviceRequest,
  RevokeDeviceResponse,
} from "./device/device-schema";
import {
  ackDispatchesResponseSchema,
  cancelDispatchResponseSchema,
  claimDispatchesResponseSchema,
  closeApprovalResponseSchema,
  createDispatchResponseSchema,
  DISPATCH_API_PATHS,
  dispatchStatusResponseSchema,
  listApprovalsResponseSchema,
  openApprovalResponseSchema,
} from "./dispatch/dispatch-schema";
import type {
  AckDispatchesRequest,
  AckDispatchesResponse,
  CancelDispatchResponse,
  ClaimDispatchesResponse,
  CloseApprovalResponse,
  CreateDispatchRequest,
  CreateDispatchResponse,
  DispatchStatusResponse,
  ListApprovalsResponse,
  OpenApprovalRequest,
  OpenApprovalResponse,
} from "./dispatch/dispatch-schema";
import { pullResponseSchema, pushResponseSchema, SYNC_API_PATHS } from "./sync/sync-schema";
import type { PullQuery, PullResponse, PushRequest, PushResponse } from "./sync/sync-schema";
import type { SocketListener, SyncPing } from "./sync/sync-ws";
import { vaultCommitResponseSchema, vaultConflictAnswerSchema } from "./vault/vault-commit-schema";
import type {
  VaultCommitConflict,
  VaultCommitRequest,
  VaultCommitResponse,
} from "./vault/vault-commit-schema";
import {
  assetMediaType,
  VAULT_API_PATHS,
  vaultFileResponseSchema,
  vaultFilesResponseSchema,
  vaultTreeResponseSchema,
} from "./vault/vault-schema";
import type {
  VaultAssetQuery,
  VaultFileQuery,
  VaultFileResponse,
  VaultFilesRequest,
  VaultFilesResponse,
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

const isTransientStatus = (status: number): boolean =>
  status >= 500 || status === 408 || status === 429;

// the envelope a refusal carried, or null when its body carried none
const failureOf = (status: number, envelope: CloudError | null): CloudFailure => {
  if (envelope === null) {
    // every refusal the worker means rides the envelope, so a bare 5xx, 408 or 429 is a fault or
    // an edge in front of it: retryable, and no verdict on the credential
    if (isTransientStatus(status)) {
      return { kind: "unreachable", message: `HTTP ${status} with no error body` };
    }
    return {
      kind: "malformed",
      message: `The cloud answered HTTP ${status} with a body this build cannot read.`,
    };
  }
  return {
    code: envelope.error.code,
    deviceSeq: envelope.error.deviceSeq ?? null,
    kind: "refused",
    message: envelope.error.message,
  };
};

const readFailure = async (response: Response): Promise<CloudFailure> => {
  const body: unknown = await response.json().catch(() => {
    /* empty */
  });
  const envelope = cloudErrorSchema.safeParse(body);
  return failureOf(response.status, envelope.success ? envelope.data : null);
};

const UNREADABLE_OK: CloudFailure = {
  kind: "malformed",
  message: "The cloud answered 200 with a body this build cannot read.",
};

// response schemas strip what they do not declare, so a newer worker may add a field and this
// build reads on. a field that changes what a row MEANS is another matter: stripped, the row
// reads as something else, so it reaches only a client whose request asks for it. 0.4.0 and
// older refuse any added field, which is why what they must read rides a new route.
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
  return parsed.success ? { ok: true, value: parsed.data } : { failure: UNREADABLE_OK, ok: false };
};

// every HTTP call on the wire is read through this, the site's cookie-authed pages included, so a
// fetch that throws is `unreachable` and never an exception one caller forgot to catch
export const readCloudCall = async <TSchema extends z.ZodType>(
  send: () => Promise<Response>,
  schema: TSchema,
): Promise<CloudResult<z.infer<TSchema>>> => {
  let response: Response;
  try {
    response = await send();
  } catch (error) {
    return { failure: unreachable(error), ok: false };
  }
  return await readValue(response, schema);
};

// the asset route answers raw bytes with their type in a header. The type must be the one the
// allowlist names for the path: a renderer handed these bytes trusts it, and an intercepting proxy
// could otherwise relabel an image as a document.
const readAssetCall = async (
  send: () => Promise<Response>,
  path: string,
): Promise<CloudResult<VaultAsset>> => {
  let response: Response;
  let bytes: Uint8Array;
  try {
    response = await send();
    if (!response.ok) {
      return { failure: await readFailure(response), ok: false };
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return { failure: unreachable(error), ok: false };
  }
  const mediaType = assetMediaType(path);
  if (mediaType === null || response.headers.get("content-type") !== mediaType) {
    return {
      failure: {
        kind: "malformed",
        message: "The cloud answered an attachment this build cannot read.",
      },
      ok: false,
    };
  }
  return { ok: true, value: { bytes, mediaType } };
};

export type VaultCommitOutcome =
  | ({ kind: "committed" } & VaultCommitResponse)
  | ({ kind: "conflict" } & VaultCommitConflict);

// a vault-conflict is an answer, not a failure: it carries the bytes the caller merges against. A
// reader that knows only the envelope still reads it as a refusal it can name.
const readCommitCall = async (
  send: () => Promise<Response>,
): Promise<CloudResult<VaultCommitOutcome>> => {
  let response: Response;
  try {
    response = await send();
  } catch (error) {
    return { failure: unreachable(error), ok: false };
  }
  const body: unknown = await response.json().catch(() => {
    /* empty */
  });
  if (response.ok) {
    const committed = vaultCommitResponseSchema.safeParse(body);
    return committed.success
      ? { ok: true, value: { kind: "committed", ...committed.data } }
      : { failure: UNREADABLE_OK, ok: false };
  }
  const answer = vaultConflictAnswerSchema.safeParse(body);
  if (answer.success && answer.data.error.code === "vault-conflict") {
    return { ok: true, value: { kind: "conflict", ...answer.data.conflict } };
  }
  const envelope = cloudErrorSchema.safeParse(body);
  return {
    failure: failureOf(response.status, envelope.success ? envelope.data : null),
    ok: false,
  };
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

// the two calls made without a credential: each one's answer is the credential
const postForCredential = async (
  endpoint: CloudEndpoint,
  path: string,
  request: DeviceLoginRequest | DeviceSignUpRequest,
): Promise<CloudResult<DeviceLoginResponse>> => {
  const call = endpoint.fetch ?? fetch;
  return await readCloudCall(
    async () =>
      await call(endpointUrl(endpoint.baseUrl, path), {
        body: JSON.stringify(request),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: callSignal(endpoint.signal),
      }),
    deviceLoginResponseSchema,
  );
};

export const postDeviceLogin = async (
  endpoint: CloudEndpoint,
  request: DeviceLoginRequest,
): Promise<CloudResult<DeviceLoginResponse>> =>
  await postForCredential(endpoint, DEVICE_API_PATHS.login, request);

export const postDeviceSignUp = async (
  endpoint: CloudEndpoint,
  request: DeviceSignUpRequest,
): Promise<CloudResult<DeviceLoginResponse>> =>
  await postForCredential(endpoint, DEVICE_API_PATHS.signUp, request);

export interface CloudClient {
  push: (request: PushRequest) => Promise<CloudResult<PushResponse>>;
  pull: (query: PullQuery) => Promise<CloudResult<PullResponse>>;
  createCapture: (request: CaptureRequest) => Promise<CloudResult<CaptureResponse>>;
  claimCaptures: (limit: number) => Promise<CloudResult<ClaimCapturesResponse>>;
  ackCaptures: (request: AckCapturesRequest) => Promise<CloudResult<AckCapturesResponse>>;
  createDispatch: (request: CreateDispatchRequest) => Promise<CloudResult<CreateDispatchResponse>>;
  claimDispatches: (limit: number) => Promise<CloudResult<ClaimDispatchesResponse>>;
  ackDispatches: (request: AckDispatchesRequest) => Promise<CloudResult<AckDispatchesResponse>>;
  dispatchStatus: (ids: readonly string[]) => Promise<CloudResult<DispatchStatusResponse>>;
  cancelDispatch: (id: string) => Promise<CloudResult<CancelDispatchResponse>>;
  openApproval: (request: OpenApprovalRequest) => Promise<CloudResult<OpenApprovalResponse>>;
  closeApproval: (id: string) => Promise<CloudResult<CloseApprovalResponse>>;
  listApprovals: () => Promise<CloudResult<ListApprovalsResponse>>;
  account: () => Promise<CloudResult<AccountResponse>>;
  // ends the account the credential belongs to, every device's credential with it, once the
  // password checks out again
  deleteAccount: (password: string) => Promise<CloudResult<DeleteAccountResponse>>;
  // the account's devices, revoked rows included, and another of them cut off: what the
  // account's web page does, asked with this device's credential
  listDevices: () => Promise<CloudResult<ListDevicesResponse>>;
  revokeDevice: (deviceId: string) => Promise<CloudResult<RevokeDeviceResponse>>;
  // revokes the device the credential names: forgetting a credential leaves its row holding one
  // of the account's device slots
  signOut: () => Promise<CloudResult<RevokeDeviceResponse>>;
  vaultTree: (query: VaultTreeQuery) => Promise<CloudResult<VaultTreeResponse>>;
  vaultFile: (query: VaultFileQuery) => Promise<CloudResult<VaultFileResponse>>;
  vaultFiles: (request: VaultFilesRequest) => Promise<CloudResult<VaultFilesResponse>>;
  // the bytes themselves, for a page that cannot put a header on an <img>
  vaultAsset: (query: VaultAssetQuery) => Promise<CloudResult<VaultAsset>>;
  vaultCommit: (request: VaultCommitRequest) => Promise<CloudResult<VaultCommitOutcome>>;
}

export interface VaultAsset {
  bytes: Uint8Array;
  mediaType: string;
}

export interface CreateCloudClientArgs extends CloudEndpoint {
  credential: string;
}

export const createCloudClient = (args: CreateCloudClientArgs): CloudClient => {
  const call = args.fetch ?? fetch;
  const authorization = `Bearer ${args.credential}`;

  const requestInit = (json: JsonBody): RequestInit => {
    const signal = callSignal(args.signal);
    return json === undefined
      ? { headers: { authorization }, method: "GET", signal }
      : {
          body: JSON.stringify(json),
          headers: { authorization, "content-type": "application/json" },
          method: "POST",
          signal,
        };
  };

  const send = async <TSchema extends z.ZodType>(
    path: string,
    json: JsonBody,
    schema: TSchema,
  ): Promise<CloudResult<z.infer<TSchema>>> =>
    await readCloudCall(
      async () => await call(endpointUrl(args.baseUrl, path), requestInit(json)),
      schema,
    );

  return {
    account: async () => await send(ACCOUNT_API_PATHS.account, undefined, accountResponseSchema),
    ackCaptures: async (request) =>
      await send(CAPTURE_API_PATHS.ack, request, ackCapturesResponseSchema),
    ackDispatches: async (request) =>
      await send(DISPATCH_API_PATHS.ack, request, ackDispatchesResponseSchema),
    cancelDispatch: async (id) =>
      await send(DISPATCH_API_PATHS.cancel, { id }, cancelDispatchResponseSchema),
    claimCaptures: async (limit) =>
      await send(CAPTURE_API_PATHS.claim, { limit }, claimCapturesResponseSchema),
    claimDispatches: async (limit) =>
      await send(DISPATCH_API_PATHS.claim, { limit }, claimDispatchesResponseSchema),
    closeApproval: async (id) =>
      await send(DISPATCH_API_PATHS.approvalClose, { id }, closeApprovalResponseSchema),
    createCapture: async (request) =>
      await send(CAPTURE_API_PATHS.capture, request, captureResponseSchema),
    createDispatch: async (request) =>
      await send(DISPATCH_API_PATHS.dispatch, request, createDispatchResponseSchema),
    deleteAccount: async (password) => {
      const request: DeleteAccountRequest = { password };
      return await send(ACCOUNT_API_PATHS.delete, request, deleteAccountResponseSchema);
    },
    dispatchStatus: async (ids) =>
      await send(DISPATCH_API_PATHS.status, { ids }, dispatchStatusResponseSchema),
    listApprovals: async () =>
      await send(DISPATCH_API_PATHS.approvals, undefined, listApprovalsResponseSchema),
    listDevices: async () =>
      await send(DEVICE_API_PATHS.list, undefined, listDevicesResponseSchema),
    openApproval: async (request) =>
      await send(DISPATCH_API_PATHS.approval, request, openApprovalResponseSchema),
    pull: async (query) =>
      await send(
        `${SYNC_API_PATHS.pull}${queryString({ afterSeq: query.afterSeq, limit: query.limit })}`,
        undefined,
        pullResponseSchema,
      ),
    push: async (request) => await send(SYNC_API_PATHS.push, request, pushResponseSchema),
    revokeDevice: async (deviceId) => {
      const request: RevokeDeviceRequest = { deviceId };
      return await send(DEVICE_API_PATHS.revoke, request, revokeDeviceResponseSchema);
    },
    // the credential names the device, so the body carries nothing
    signOut: async () => await send(DEVICE_API_PATHS.signOut, {}, revokeDeviceResponseSchema),
    // every vault read posts its query and the credential rides a header: neither reaches the URL,
    // which logs and traces keep
    vaultAsset: async (query) =>
      await readAssetCall(
        async () =>
          await call(endpointUrl(args.baseUrl, VAULT_API_PATHS.asset), requestInit(query)),
        query.path,
      ),
    vaultCommit: async (request) =>
      await readCommitCall(
        async () =>
          await call(endpointUrl(args.baseUrl, VAULT_API_PATHS.commit), requestInit(request)),
      ),
    vaultFile: async (query) => await send(VAULT_API_PATHS.file, query, vaultFileResponseSchema),
    vaultFiles: async (request) =>
      await send(VAULT_API_PATHS.files, request, vaultFilesResponseSchema),
    vaultTree: async (query) => await send(VAULT_API_PATHS.tree, query, vaultTreeResponseSchema),
  };
};

// both clients open it with sync/cloud-socket.ts; a runtime takes the opener rather than
// building it, so a test hands it a fake that never dials.
export interface CloudSocket {
  close: () => void;
}

export interface OpenCloudSocketArgs {
  baseUrl: string;
  credential: string;
  listener: SocketListener;
  onOpen: () => void;
  onPing: (ping: SyncPing) => void;
  // called once even if the socket never opened. SYNC_WS_REVOKED_CLOSE_CODE is a hint that runs
  // an http pass; the pass's terminal refusal is what halts the transport.
  onClose: (code: number) => void;
}

export type CloudSocketOpener = (args: OpenCloudSocketArgs) => CloudSocket;
