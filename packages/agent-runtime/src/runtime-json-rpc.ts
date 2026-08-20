// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";
import { z } from "zod";
import { jsonValueSchema } from "./vocabulary/json-value.js";
import type { ProviderRequestCommandPlan } from "./provider-adapter.js";

/**
 * A decoded JSON-RPC frame, before the role its fields imply (response,
 * request, notification) has been established — `parseJsonRpcLine` is what
 * establishes that. Which fields the wire sent is exactly what the reader
 * cannot assume, so each is optional and `params`/`result`/`error` stay
 * uninterpreted until a schema for the specific method parses them.
 */
export interface JsonRpcObject {
  jsonrpc?: unknown;
  id?: string | number | undefined;
  method?: string | undefined;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface JsonRpcMessage extends JsonRpcObject {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

export interface ProviderInboundRequest {
  id?: string | number;
  method: string;
  params?: unknown;
}

export type ProviderRuntimeEvent = JsonRpcObject;

export const JSON_RPC_INVALID_PARAMS_CODE = -32602;

export class ProviderRequestDecodeError extends Error {
  readonly code = JSON_RPC_INVALID_PARAMS_CODE;

  constructor(message: string) {
    super(message);
    this.name = "ProviderRequestDecodeError";
  }
}

export class ProviderResponseEncodeError extends Error {
  readonly code = JSON_RPC_INVALID_PARAMS_CODE;

  constructor(message: string) {
    super(message);
    this.name = "ProviderResponseEncodeError";
  }
}

export class JsonRpcResponseError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "JsonRpcResponseError";
    this.code = code;
  }
}

export interface PendingJsonRpcRequest {
  /** Handed the whole response frame: the caller's `resultSchema` is the only
   *  thing that can say what its `result` means. */
  resolve: (response: JsonRpcObject) => void;
  reject: (error: Error) => void;
}

/** The `result` member as JSON, for requests whose payload the caller either
 *  ignores or parses itself. Never fails the request: a response carrying no
 *  usable result resolves as null, exactly as an ignored one does. */
export const ignoredJsonRpcResultSchema = jsonValueSchema.catch(() => null);

export interface ParsedJsonRpcNonJsonLine {
  kind: "non_json";
}

export interface ParsedJsonRpcInvalidLine {
  kind: "invalid_json_rpc";
}

export interface ParsedJsonRpcResponseLine {
  kind: "response";
  parsed: JsonRpcObject;
  parsedId: string | number;
}

export interface ParsedJsonRpcRequestLine {
  kind: "request";
  parsedId: string | number;
  parsedMethod: string;
  rawRequest: JsonRpcMessage;
}

export interface ParsedJsonRpcNotificationLine {
  kind: "notification";
  notificationMethod: string;
  parsed: JsonRpcObject;
}

export type ParsedJsonRpcLine =
  | ParsedJsonRpcNonJsonLine
  | ParsedJsonRpcInvalidLine
  | ParsedJsonRpcResponseLine
  | ParsedJsonRpcRequestLine
  | ParsedJsonRpcNotificationLine;

export interface SendJsonRpcRequestArgs<TResult> {
  child: ChildProcess;
  getNextId: () => number;
  message: JsonRpcMessage | ProviderRequestCommandPlan;
  pending: Map<string | number, PendingJsonRpcRequest>;
  resultSchema: z.ZodType<TResult>;
  timeoutMs?: number;
}

interface SendJsonRpcResultArgs {
  child: ChildProcess;
  id: string | number;
  result: unknown;
}

interface SendJsonRpcErrorArgs {
  child: ChildProcess;
  code?: number;
  id: string | number;
  message: string;
}

interface SendProviderRequestDecodeErrorArgs {
  child: ChildProcess;
  error: unknown;
  id: string | number;
}

interface SendProviderResponseEncodeErrorArgs {
  child: ChildProcess;
  error: unknown;
  id: string | number;
}

interface SettleJsonRpcResponseArgs {
  id: string | number;
  pending: Map<string | number, PendingJsonRpcRequest>;
  response: JsonRpcObject;
}

const closedJsonRpcStdinErrorCodes = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);
const jsonRpcStdinErrorHandledStreams = new WeakSet<Writable>();

/** A frame off the wire. A field the peer spelled in a shape this protocol
 *  has no reading for is taken as absent rather than failing the frame — the
 *  role branches below are what decide whether the remainder is usable. */
const jsonRpcFrameSchema = z.looseObject({
  jsonrpc: z.unknown().optional(),
  id: z
    .union([z.string(), z.number()])
    .optional()
    .catch(() => undefined),
  method: z
    .string()
    .optional()
    .catch(() => undefined),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

/** A JSON-RPC `error` member: `code` and `message` when the peer sent a
 *  well-formed one, absent fields when it did not. */
const jsonRpcErrorPayloadSchema = z.looseObject({
  code: z
    .number()
    .optional()
    .catch(() => undefined),
  message: z
    .string()
    .optional()
    .catch(() => undefined),
  // A `message` the peer sent in a shape this cannot read is the same fact as
  // one it never sent: `formatJsonRpcErrorMessage` falls back to the payload.
});

/** Node stamps a string `code` on the stream errors this module recognizes. */
const errnoSchema = z.looseObject({ code: z.string() });

function formatJsonRpcErrorMessage(cause: unknown): string {
  const payload = jsonRpcErrorPayloadSchema.safeParse(cause);
  if (payload.success && payload.data.message !== undefined) {
    return payload.data.message;
  }
  return JSON.stringify(cause);
}

function jsonRpcResponseError(cause: unknown): Error {
  const payload = jsonRpcErrorPayloadSchema.safeParse(cause);
  if (payload.success && payload.data.code !== undefined && payload.data.message !== undefined) {
    return new JsonRpcResponseError(payload.data.code, payload.data.message);
  }
  return new Error(formatJsonRpcErrorMessage(cause));
}

function isClosedJsonRpcStdinError(cause: Error): boolean {
  const errno = errnoSchema.safeParse(cause);
  return errno.success && closedJsonRpcStdinErrorCodes.has(errno.data.code);
}

function handleJsonRpcStdinError(error: Error): void {
  if (isClosedJsonRpcStdinError(error)) {
    return;
  }
  throw error;
}

function ensureJsonRpcStdinErrorHandler(stdin: Writable): void {
  if (jsonRpcStdinErrorHandledStreams.has(stdin)) {
    return;
  }
  jsonRpcStdinErrorHandledStreams.add(stdin);
  stdin.on("error", handleJsonRpcStdinError);
}

function writeJsonRpcLine(child: ChildProcess, line: string): void {
  const stdin = child.stdin;
  if (!stdin || stdin.destroyed || !stdin.writable) {
    return;
  }
  ensureJsonRpcStdinErrorHandler(stdin);
  stdin.write(line + "\n");
}

export function parseJsonRpcLine(line: string): ParsedJsonRpcLine {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return { kind: "non_json" };
  }

  const frame = jsonRpcFrameSchema.safeParse(decoded);
  if (!frame.success) {
    return { kind: "invalid_json_rpc" };
  }

  const parsed = frame.data;
  const parsedId = parsed.id;
  const parsedMethod = parsed.method;
  if (parsedId !== undefined && !parsedMethod) {
    return {
      kind: "response",
      parsed,
      parsedId,
    };
  }

  if (parsedId !== undefined && parsedMethod !== undefined) {
    const rawRequest: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: parsedId,
      method: parsedMethod,
    };
    if (Object.hasOwn(parsed, "params")) rawRequest.params = parsed.params;
    return {
      kind: "request",
      parsedId,
      parsedMethod,
      rawRequest,
    };
  }

  if (parsedMethod !== undefined) {
    return {
      kind: "notification",
      notificationMethod: parsedMethod,
      parsed,
    };
  }

  return { kind: "invalid_json_rpc" };
}

export function getJsonRpcStringParam(message: JsonRpcObject, key: string): string | undefined {
  const params = z.record(z.string(), z.unknown()).safeParse(message.params);
  if (!params.success) {
    return undefined;
  }

  const value = z.string().safeParse(params.data[key]);
  return value.success ? value.data : undefined;
}

export function settleJsonRpcResponse(args: SettleJsonRpcResponseArgs): void {
  const pending = args.pending.get(args.id);
  if (!pending) {
    return;
  }

  args.pending.delete(args.id);
  if (args.response.error) {
    pending.reject(jsonRpcResponseError(args.response.error));
    return;
  }

  pending.resolve(args.response);
}

export function sendJsonRpc(
  child: ChildProcess,
  message: JsonRpcMessage | ProviderRequestCommandPlan,
): void {
  const line = JSON.stringify(toJsonRpcMessage(message));
  writeJsonRpcLine(child, line);
}

export function toJsonRpcMessage(
  message: JsonRpcMessage | ProviderRequestCommandPlan,
): JsonRpcMessage {
  if ("jsonrpc" in message) {
    return message;
  }
  const converted: JsonRpcMessage = {
    jsonrpc: "2.0",
    method: message.method,
  };
  if (message.params !== undefined) converted.params = message.params;
  return converted;
}

export function sendJsonRpcRequest<TResult>(
  args: SendJsonRpcRequestArgs<TResult>,
): Promise<TResult> {
  const id = args.getNextId();
  const message = toJsonRpcMessage(args.message);
  const withId: JsonRpcMessage = { ...message, id };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      args.pending.delete(id);
      reject(new Error(`JSON-RPC request timed out: ${message.method}`));
    }, args.timeoutMs ?? 30_000);
    args.pending.set(id, {
      resolve: (response) => {
        clearTimeout(timer);
        const parsedResult = args.resultSchema.safeParse(response.result);
        if (!parsedResult.success) {
          reject(new Error(`Invalid JSON-RPC result for ${message.method}`));
          return;
        }
        resolve(parsedResult.data);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    sendJsonRpc(args.child, withId);
  });
}

export function sendJsonRpcResult(args: SendJsonRpcResultArgs): void {
  writeJsonRpcLine(
    args.child,
    JSON.stringify({
      jsonrpc: "2.0",
      id: args.id,
      result: args.result,
    }),
  );
}

export function sendJsonRpcError(args: SendJsonRpcErrorArgs): void {
  writeJsonRpcLine(
    args.child,
    JSON.stringify({
      jsonrpc: "2.0",
      id: args.id,
      error: {
        code: args.code ?? -32000,
        message: args.message,
      },
    }),
  );
}

export function sendProviderRequestDecodeErrorIfKnown(
  args: SendProviderRequestDecodeErrorArgs,
): boolean {
  if (!(args.error instanceof ProviderRequestDecodeError)) {
    return false;
  }

  sendJsonRpcError({
    child: args.child,
    id: args.id,
    message: args.error.message,
    code: args.error.code,
  });
  return true;
}

export function sendProviderResponseEncodeErrorIfKnown(
  args: SendProviderResponseEncodeErrorArgs,
): boolean {
  if (!(args.error instanceof ProviderResponseEncodeError)) {
    return false;
  }

  sendJsonRpcError({
    child: args.child,
    id: args.id,
    message: args.error.message,
    code: args.error.code,
  });
  return true;
}
