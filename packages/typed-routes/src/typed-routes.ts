// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

/**
 * Contract-enforced route registration for Hono.
 *
 * Hono's built-in `.get()` / `.post()` methods infer the schema from the
 * handler (bottom-up). They never constrain the handler against a pre-declared
 * contract. These helpers close that gap: registration takes a `defineRoute`
 * descriptor — the table IS the contract — and enforces the handler against
 * it at compile time.
 *
 * **Output**: the handler's `c.json()` argument must match the descriptor's
 * declared Output type.
 *
 * **Input**: a descriptor declaring a `query` or `json` request carries its
 * own Zod schema. The wrapper validates the request automatically and passes
 * the parsed value to the handler.
 *
 * @example
 * ```ts
 * const { get, post } = typedRoutes(app);
 *
 * // Schema and validation come from the row:
 * get(apiRoutes.health, (c) => c.json({ ok: true }));
 * post(apiRoutes.docs.create, async (c, body) => {
 *   const doc = createDoc(deps.db, body);
 *   return c.json(doc, 201);
 * });
 * ```
 */
import type { Context, Hono } from "hono";
import type { BlankEnv } from "hono/types";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError, ZodType, z } from "zod";
import type { Endpoint } from "./endpoint";
import type {
  EndpointFromRouteDescriptor,
  RouteDefinition,
  RouteMethod,
  RouteParsedInput,
  RouteResponseFormat,
} from "./route-descriptor";

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

/** Handler that receives context only (no request input). */
type NoBodyHandler<E, Path extends string> = (c: TypedContext<E, Path>) => HandlerReturn;

/** Handler that receives context + pre-validated request input. */
type WithInputHandler<E, Input, Path extends string> = (
  c: TypedContext<E, Path>,
  input: Input,
) => HandlerReturn;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

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

export interface TypedRoutesRegistrars {
  get: TypedDescriptorRegister<"get">;
  post: TypedDescriptorRegister<"post">;
  patch: TypedDescriptorRegister<"patch">;
  del: TypedDescriptorRegister<"delete">;
  put: TypedDescriptorRegister<"put">;
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

type LooseHandler = (c: Context, input?: z.output<ZodType>) => HandlerReturn;
type MountableHandler = (c: Context) => HandlerReturn;

/** What the registrars' precise generic handler types erase to at the runtime
 *  boundary: `never[]` keeps every instantiation assignable without a cast,
 *  and the contract below re-establishes callability by parsing. */
type RegisteredHandler = (...args: never[]) => HandlerReturn;

/** The registration call sites are typed exhaustively above; these contracts
 *  re-establish the same facts for the loosely-typed runtime without casts. */
const registeredHandlerContract = z.custom<LooseHandler>((value) => value instanceof Function);

const routeSchemaContract = z.custom<ZodType>((value) => value instanceof ZodType);

const routeRequestContract = z.union([
  z.looseObject({ source: z.literal("none") }),
  z.looseObject({ source: z.enum(["query", "json"]), schema: routeSchemaContract }),
]);

const routeDefinitionContract = z
  .looseObject({
    path: z.string().min(1),
    method: z.enum(["get", "post", "patch", "delete", "put"]),
    request: routeRequestContract,
  })
  // `response` is never read at runtime, so only its presence is checked —
  // `z.unknown()` would accept an absent key.
  .refine((definition) => "response" in definition);

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
  source: "json" | "query";
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

function registerRoute(
  deps: RegistrarDeps,
  method: RouteMethod,
  descriptor: RouteDefinition,
  handler: RegisteredHandler,
): void {
  const definition = routeDefinitionContract.safeParse(descriptor);
  if (!definition.success) {
    throw new Error(
      "typedRoutes: expected a route definition (path + method + request + response)",
    );
  }
  if (definition.data.method !== method) {
    throw new Error(
      `typedRoutes: route "${definition.data.path}" declares method "${definition.data.method}" but was registered as "${method}"`,
    );
  }
  const mountable = registeredHandlerContract.safeParse(handler);
  if (!mountable.success) {
    throw new Error("typedRoutes: expected a handler for the route definition");
  }
  const request = definition.data.request;
  if (request.source === "query" || request.source === "json") {
    mount(
      deps.app,
      method,
      definition.data.path,
      createValidatedHandler({
        handler: mountable.data,
        makeError: deps.makeError,
        schema: request.schema,
        source: request.source,
      }),
    );
    return;
  }
  mount(deps.app, method, definition.data.path, mountable.data);
}

export function typedRoutes(app: Hono, options?: TypedRoutesOptions): TypedRoutesRegistrars {
  const makeError = options?.onValidationError ?? ((message: string) => new Error(message));
  const deps: RegistrarDeps = { app, makeError };

  return {
    get: (descriptor: RouteDefinition, handler: RegisteredHandler) =>
      registerRoute(deps, "get", descriptor, handler),
    post: (descriptor: RouteDefinition, handler: RegisteredHandler) =>
      registerRoute(deps, "post", descriptor, handler),
    patch: (descriptor: RouteDefinition, handler: RegisteredHandler) =>
      registerRoute(deps, "patch", descriptor, handler),
    del: (descriptor: RouteDefinition, handler: RegisteredHandler) =>
      registerRoute(deps, "delete", descriptor, handler),
    put: (descriptor: RouteDefinition, handler: RegisteredHandler) =>
      registerRoute(deps, "put", descriptor, handler),
  };
}
