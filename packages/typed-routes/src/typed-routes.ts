// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

/**
 * Contract-enforced route registration for Hono.
 *
 * Hono's built-in `.get()` / `.post()` methods infer the schema from the
 * handler (bottom-up). They never constrain the handler against a pre-declared
 * schema. These helpers close that gap: given a schema type like `ApiSchema`,
 * they extract the expected `Input` and `Output` for each route and enforce
 * both at compile time.
 *
 * **Output**: the handler's `c.json()` argument must match the contract's
 * declared Output type.
 *
 * **Input**:
 * - if the contract declares `{ json: T }`, the registration call requires a
 *   `ZodType<T>` schema. The wrapper validates the request body automatically
 *   and passes the parsed value to the handler.
 * - if the contract declares `{ query: T }`, the registration call requires a
 *   `ZodType<T>` schema. The wrapper validates the query parameters and passes
 *   the parsed value to the handler.
 *
 * @example
 * ```ts
 * const { get, post } = typedRoutes<ApiSchema>(app);
 *
 * // Registration from a defineRoute descriptor — schema comes from the row:
 * get(apiRoutes.health, (c) => c.json({ ok: true }));
 *
 * // POST — schema required, body pre-validated, output type-checked:
 * post("/docs", createDocRequestSchema, async (c, body) => {
 *   const doc = createDoc(deps.db, body);
 *   return c.json(doc, 201);
 * });
 * ```
 */
import type { Context, Hono } from "hono";
import type { BlankEnv } from "hono/types";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError, type ZodType } from "zod";
import type { Endpoint } from "./endpoint";
import type {
  AnyRouteRequestDescriptor,
  EndpointFromRouteDescriptor,
  RouteDefinition,
  RouteMethod,
  RouteParsedInput,
  RouteResponseFormat,
} from "./route-descriptor";

// ---------------------------------------------------------------------------
// Type-level extraction
// ---------------------------------------------------------------------------

type EndpointInput<E> =
  E extends Endpoint<infer I, unknown, number, RouteResponseFormat> ? I : never;

/** Extract `T` from `{ json: T }` in the Endpoint's Input, or `never`. */
type JsonBody<I> = "json" extends keyof I ? (I extends { json: infer J } ? J : never) : never;

/** Extract `T` from `{ query: T }` in the Endpoint's Input, or `never`. */
type QueryInput<I> = "query" extends keyof I ? (I extends { query?: infer Q } ? Q : never) : never;

type RouteInputForMethod<MKey extends MethodKey, I> = MKey extends "$get"
  ? QueryInput<I>
  : JsonBody<I>;

// ---------------------------------------------------------------------------
// Constrained context & handler types
// ---------------------------------------------------------------------------

type HandlerReturn = Response | Promise<Response>;

/**
 * Build the valid argument tuples for `json()` from an Endpoint (or union).
 *
 * Each union member produces its own `[data, status]` or `[data]` tuple.
 * The result is a union of tuples, so `c.json(A, 200)` and `c.json(B, 409)`
 * are both legal but `c.json(A, 409)` is not — TypeScript checks the tuple
 * as a whole, preserving the output↔status pairing.
 */
type TypedJsonArgs<E> =
  E extends Endpoint<unknown, infer O, infer S extends ContentfulStatusCode, RouteResponseFormat>
    ? 200 extends S
      ? [data: O] | [data: O, status: S]
      : [data: O, status: S]
    : never;

/**
 * A Context with a constrained `json()` method.
 *
 * For union endpoints, `json()` accepts a union of argument tuples —
 * one per Endpoint member — so the output↔status pairing is preserved.
 */
type TypedContext<E, Path extends string> = Omit<Context<BlankEnv, Path>, "json"> & {
  json: (...args: TypedJsonArgs<E>) => Response;
};

/** Handler that receives context only (no request body). */
type NoBodyHandler<E, Path extends string> = (c: TypedContext<E, Path>) => HandlerReturn;

/** Handler that receives context + pre-validated request input. */
type WithInputHandler<E, Input, Path extends string> = (
  c: TypedContext<E, Path>,
  input: Input,
) => HandlerReturn;

// ---------------------------------------------------------------------------
// Registration overloads
// ---------------------------------------------------------------------------

type MethodKey = "$get" | "$post" | "$patch" | "$delete" | "$put";
type InputSource = "json" | "query";

/**
 * Typed route registration.
 *
 * - If the endpoint declares `{ json: T }` or `{ query: T }` input
 *   → requires `(path, schema, handler)`
 * - Otherwise → requires `(path, handler)`
 */
type TypedRegister<Schema, MKey extends MethodKey> = <
  Path extends string & keyof Schema,
  E extends (MKey extends keyof Schema[Path] ? Schema[Path][MKey] : never),
  Input extends RouteInputForMethod<MKey, EndpointInput<E>>,
>(
  ...args: [Input] extends [never]
    ? [path: Path, handler: NoBodyHandler<E, Path>]
    : [path: Path, schema: ZodType<Input>, handler: WithInputHandler<E, Input, Path>]
) => void;

type DescriptorHandler<
  Descriptor extends RouteDefinition,
  E extends EndpointFromRouteDescriptor<Descriptor>,
  ParsedInput extends RouteParsedInput<Descriptor["request"]>,
> = [ParsedInput] extends [never]
  ? NoBodyHandler<E, Descriptor["path"]>
  : WithInputHandler<E, ParsedInput, Descriptor["path"]>;

type TypedDescriptorRegister<Method extends RouteMethod> = <
  Descriptor extends RouteDefinition<string, Method>,
  E extends EndpointFromRouteDescriptor<Descriptor>,
  ParsedInput extends RouteParsedInput<Descriptor["request"]>,
>(
  descriptor: Descriptor,
  handler: DescriptorHandler<Descriptor, E, ParsedInput>,
) => void;

type TypedRegisterWithDescriptor<
  Schema,
  MKey extends MethodKey,
  Method extends RouteMethod,
> = TypedRegister<Schema, MKey> & TypedDescriptorRegister<Method>;

export interface TypedRoutesRegistrars<Schema> {
  get: TypedRegisterWithDescriptor<Schema, "$get", "get">;
  post: TypedRegisterWithDescriptor<Schema, "$post", "post">;
  patch: TypedRegisterWithDescriptor<Schema, "$patch", "patch">;
  del: TypedRegisterWithDescriptor<Schema, "$delete", "delete">;
  put: TypedRegisterWithDescriptor<Schema, "$put", "put">;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface TypedRoutesOptions {
  /** Factory for validation errors. Receives the Zod issue message. */
  onValidationError?: (message: string) => Error;
}

const zodV4MissingInputMessagePrefix = "Invalid input: expected ";
const zodV4MissingInputMessageSuffix = ", received undefined";

function validationMessageFromZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid request";
  }
  if (
    issue.code === "invalid_type" &&
    issue.input === undefined &&
    issue.message.startsWith(zodV4MissingInputMessagePrefix) &&
    issue.message.endsWith(zodV4MissingInputMessageSuffix)
  ) {
    return "Required";
  }
  return issue.message;
}

type LooseHandler = (c: Context, input?: unknown) => HandlerReturn;
type MountableHandler = (c: Context) => HandlerReturn;

/** The registration call sites are typed exhaustively above; these predicates
 *  re-establish the same facts for the loosely-typed runtime without casts. */
function isLooseHandler(value: unknown): value is LooseHandler {
  return typeof value === "function";
}

function isZodSchema(value: unknown): value is ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "parse" in value &&
    typeof value.parse === "function"
  );
}

const ROUTE_METHODS: readonly RouteMethod[] = ["get", "post", "patch", "delete", "put"];

function isRouteMethod(value: unknown): value is RouteMethod {
  return typeof value === "string" && ROUTE_METHODS.some((method) => method === value);
}

function isRouteRequestDescriptor(value: unknown): value is AnyRouteRequestDescriptor {
  if (typeof value !== "object" || value === null || !("source" in value)) {
    return false;
  }
  if (value.source === "none") {
    return true;
  }
  if (value.source !== "query" && value.source !== "json") {
    return false;
  }
  return "schema" in value && isZodSchema(value.schema);
}

function isRouteDefinition(value: unknown): value is RouteDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    "method" in value &&
    isRouteMethod(value.method) &&
    "request" in value &&
    isRouteRequestDescriptor(value.request) &&
    "response" in value
  );
}

interface RegistrarDeps {
  app: Hono;
  makeError: (message: string) => Error;
}

function mount(app: Hono, method: RouteMethod, path: string, handler: MountableHandler): void {
  switch (method) {
    case "get":
      app.get(path, handler);
      return;
    case "post":
      app.post(path, handler);
      return;
    case "patch":
      app.patch(path, handler);
      return;
    case "delete":
      app.delete(path, handler);
      return;
    case "put":
      app.put(path, handler);
      return;
  }
}

function createValidatedHandler(args: {
  handler: LooseHandler;
  makeError: (message: string) => Error;
  schema: ZodType;
  source: InputSource;
}): MountableHandler {
  return async (c) => {
    let input: unknown;
    if (args.source === "query") {
      input = c.req.query();
    } else {
      try {
        input = await c.req.json();
      } catch {
        throw args.makeError("Invalid JSON request body");
      }
    }
    let parsed: unknown;
    try {
      parsed = args.schema.parse(input);
    } catch (error) {
      if (error instanceof ZodError) {
        throw args.makeError(validationMessageFromZodError(error));
      }
      throw error;
    }
    return args.handler(c, parsed);
  };
}

function registerFromArgs(
  deps: RegistrarDeps,
  method: RouteMethod,
  inputSource: InputSource,
  args: readonly unknown[],
): void {
  const [first, second, third] = args;

  if (typeof first === "string") {
    if (isZodSchema(second)) {
      if (!isLooseHandler(third)) {
        throw new Error("typedRoutes: expected a handler after the schema");
      }
      mount(
        deps.app,
        method,
        first,
        createValidatedHandler({
          handler: third,
          makeError: deps.makeError,
          schema: second,
          source: inputSource,
        }),
      );
      return;
    }
    if (!isLooseHandler(second)) {
      throw new Error("typedRoutes: expected a handler or a schema");
    }
    mount(deps.app, method, first, second);
    return;
  }

  if (!isRouteDefinition(first)) {
    throw new Error(
      "typedRoutes: expected a path or a route definition (path + method + request + response)",
    );
  }
  if (first.method !== method) {
    throw new Error(
      `typedRoutes: route "${first.path}" declares method "${first.method}" but was registered as "${method}"`,
    );
  }
  if (!isLooseHandler(second)) {
    throw new Error("typedRoutes: expected a handler for the route definition");
  }
  const request = first.request;
  if (request.source === "query" || request.source === "json") {
    mount(
      deps.app,
      method,
      first.path,
      createValidatedHandler({
        handler: second,
        makeError: deps.makeError,
        schema: request.schema,
        source: request.source,
      }),
    );
    return;
  }
  mount(deps.app, method, first.path, second);
}

export function typedRoutes<Schema>(
  app: Hono,
  options?: TypedRoutesOptions,
): TypedRoutesRegistrars<Schema> {
  const makeError = options?.onValidationError ?? ((message: string) => new Error(message));
  const deps: RegistrarDeps = { app, makeError };

  return {
    get: (...args: readonly unknown[]) => registerFromArgs(deps, "get", "query", args),
    post: (...args: readonly unknown[]) => registerFromArgs(deps, "post", "json", args),
    patch: (...args: readonly unknown[]) => registerFromArgs(deps, "patch", "json", args),
    del: (...args: readonly unknown[]) => registerFromArgs(deps, "delete", "json", args),
    put: (...args: readonly unknown[]) => registerFromArgs(deps, "put", "json", args),
  };
}
