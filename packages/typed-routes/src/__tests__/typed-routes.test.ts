// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { EmptyInput, Endpoint } from "../endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  optionalQueryRequest,
  type ApiSchemaFromRouteDescriptors,
} from "../route-descriptor";
import { typedRoutes } from "../typed-routes";

type TestSchema = {
  "/search": {
    $get: Endpoint<{ query: { q: string } }, { q: string }>;
  };
  "/ping": {
    $get: Endpoint<EmptyInput, { ok: true }>;
  };
};

const testRoutes = {
  search: defineRoute({
    path: "/search",
    method: "get",
    request: optionalQueryRequest<EmptyInput, { q: string }>(z.object({ q: z.string().min(1) })),
    response: jsonResponse<{ q: string }>(),
  }),
  createNote: defineRoute({
    path: "/notes",
    method: "post",
    request: jsonRequest<EmptyInput, { title: string }>(z.object({ title: z.string().min(1) })),
    response: jsonResponse<{ title: string }>({ status: 201 }),
  }),
};

type DescriptorTestSchema = ApiSchemaFromRouteDescriptors<typeof testRoutes>;

function createApp() {
  const app = new Hono();
  app.onError((error, context) => {
    return context.json({ message: error.message }, 400);
  });
  return app;
}

describe("typedRoutes", () => {
  it("parses GET query inputs instead of requiring a JSON body", async () => {
    const app = createApp();
    const { get } = typedRoutes<TestSchema>(app, {
      onValidationError: (message) => new Error(message),
    });

    get("/search", z.object({ q: z.string().min(1) }), (context, query) =>
      context.json({ q: query.q }),
    );

    const success = await app.request("/search?q=needle");
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ q: "needle" });

    const missingQuery = await app.request("/search", { method: "GET" });
    expect(missingQuery.status).toBe(400);
    expect(await missingQuery.json()).toEqual({ message: "Required" });
  });

  it("supports GET handlers with no query schema", async () => {
    const app = createApp();
    const { get } = typedRoutes<TestSchema>(app, {
      onValidationError: (message) => new Error(message),
    });

    get("/ping", (context) => context.json({ ok: true }));

    const response = await app.request("/ping");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("registers descriptor routes with their request schema", async () => {
    const app = createApp();
    const { get } = typedRoutes<DescriptorTestSchema>(app, {
      onValidationError: (message) => new Error(message),
    });

    get(testRoutes.search, (context, query) => context.json({ q: query.q }));

    const success = await app.request("/search?q=needle");
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ q: "needle" });

    const missingQuery = await app.request("/search", { method: "GET" });
    expect(missingQuery.status).toBe(400);
    expect(await missingQuery.json()).toEqual({ message: "Required" });
  });

  it("throws loudly on a malformed descriptor", () => {
    const app = createApp();
    const { get } = typedRoutes<DescriptorTestSchema>(app);

    const missingSchema: unknown = {
      path: "/search",
      method: "get",
      request: { source: "query" },
      response: { status: 200, format: "json" },
    };
    const badMethod: unknown = {
      path: "/search",
      method: "fetch",
      request: { source: "none" },
      response: { status: 200, format: "json" },
    };
    const looseGet = get as (...args: unknown[]) => void;
    expect(() => looseGet(missingSchema, () => new Response())).toThrow(
      /expected a path or a route definition/,
    );
    expect(() => looseGet(badMethod, () => new Response())).toThrow(
      /expected a path or a route definition/,
    );
  });

  it("throws when a descriptor is registered under the wrong method", () => {
    const app = createApp();
    const { post } = typedRoutes<DescriptorTestSchema>(app);
    const loosePost = post as (...args: unknown[]) => void;
    expect(() => loosePost(testRoutes.search, () => new Response())).toThrow(
      /declares method "get" but was registered as "post"/,
    );
  });

  it("validates JSON bodies on descriptor POST routes", async () => {
    const app = createApp();
    const { post } = typedRoutes<DescriptorTestSchema>(app, {
      onValidationError: (message) => new Error(message),
    });

    post(testRoutes.createNote, (context, body) => context.json({ title: body.title }, 201));

    const created = await app.request("/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "First" }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ title: "First" });

    const invalidBody = await app.request("/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(invalidBody.status).toBe(400);
    expect(await invalidBody.json()).toEqual({
      message: "Invalid JSON request body",
    });

    const missingTitle = await app.request("/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missingTitle.status).toBe(400);
    expect(await missingTitle.json()).toEqual({ message: "Required" });
  });
});
