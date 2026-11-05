// a refusal is a value, never a throw: every caller switches on the closed code, and an
// `Error("HTTP 409")` would retry a request the server refuses forever. `unreachable` is no
// verdict on the credential; `malformed` is a body this build cannot read (an intercepting proxy).

import type { z } from "zod";
import { ACCOUNT_API_PATHS, deleteAccountResponseSchema } from "./account/account-schema";
import type {
  DeleteAccountRequest,
  DeleteAccountResponse,
  DeviceSignUpRequest,
} from "./account/account-schema";
import { clientBuildHeaders } from "./client-build";
import type { ClientBuild } from "./client-build";
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

export type CloudFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type CloudFailure =
  | { kind: "refused"; code: CloudErrorCode; message: string }
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
  return { code: envelope.error.code, kind: "refused", message: envelope.error.message };
};

// a body that stopped arriving (the call's deadline mid-transfer, a reset) is the network failing,
// never a body this build cannot read; one that arrived and is not json reads as undefined, which
// no schema takes
const readBody = async (response: Response): Promise<CloudResult<unknown>> => {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { failure: unreachable(error), ok: false };
  }
  try {
    const body: unknown = JSON.parse(text);
    return { ok: true, value: body };
  } catch {
    return { ok: true, value: undefined };
  }
};

const readFailure = async (response: Response): Promise<CloudFailure> => {
  const body = await readBody(response);
  if (!body.ok) {
    return body.failure;
  }
  const envelope = cloudErrorSchema.safeParse(body.value);
  return failureOf(response.status, envelope.success ? envelope.data : null);
};

const UNREADABLE_OK: CloudFailure = {
  kind: "malformed",
  message: "The cloud answered 200 with a body this build cannot read.",
};

// response schemas strip what they do not declare, so a newer worker may add a field and this
// build reads on. a field that changes what a row MEANS is another matter: stripped, the row
// reads as something else, so it reaches only a client whose request asks for it.
const readValue = async <TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
): Promise<CloudResult<z.infer<TSchema>>> => {
  if (!response.ok) {
    return { failure: await readFailure(response), ok: false };
  }
  const body = await readBody(response);
  if (!body.ok) {
    return body;
  }
  const parsed = schema.safeParse(body.value);
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

// a black-holed request would stall its caller and the teardown waiting on it; undici's own
// default is 300s of headers timeout.
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
  // rides every request, the two that ask for a credential included: the Worker refuses a build
  // below its floor before it reads anything else
  build: ClientBuild;
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
        headers: { ...clientBuildHeaders(endpoint.build), "content-type": "application/json" },
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
}

export interface CreateCloudClientArgs extends CloudEndpoint {
  credential: string;
}

export const createCloudClient = (args: CreateCloudClientArgs): CloudClient => {
  const call = args.fetch ?? fetch;
  const headers = { ...clientBuildHeaders(args.build), authorization: `Bearer ${args.credential}` };

  const requestInit = (json: JsonBody): RequestInit => {
    const signal = callSignal(args.signal);
    return json === undefined
      ? { headers, method: "GET", signal }
      : {
          body: JSON.stringify(json),
          headers: { ...headers, "content-type": "application/json" },
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
    deleteAccount: async (password) => {
      const request: DeleteAccountRequest = { password };
      return await send(ACCOUNT_API_PATHS.delete, request, deleteAccountResponseSchema);
    },
    listDevices: async () =>
      await send(DEVICE_API_PATHS.list, undefined, listDevicesResponseSchema),
    revokeDevice: async (deviceId) => {
      const request: RevokeDeviceRequest = { deviceId };
      return await send(DEVICE_API_PATHS.revoke, request, revokeDeviceResponseSchema);
    },
    // the credential names the device, so the body carries nothing
    signOut: async () => await send(DEVICE_API_PATHS.signOut, {}, revokeDeviceResponseSchema),
  };
};
