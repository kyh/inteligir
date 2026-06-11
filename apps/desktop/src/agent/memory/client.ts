/**
 * Minimal HTTP client for a self-hosted supermemory server
 * (https://supermemory.ai/docs/self-hosting/overview). The server runs
 * locally (`npx supermemory local`, default http://localhost:6767) and
 * exposes the hosted Memory API; localhost requests are auto-authenticated
 * so no key exchange is needed for the default setup.
 *
 * Deliberately fetch-based instead of the `supermemory` SDK — we use five
 * endpoints with fixed shapes, and a dependency-free client keeps the
 * experiment easy to rip out or swap for the hosted platform later.
 * Responses are narrowed field-by-field (never cast): the server is an
 * external process and its payloads are untrusted input.
 */

import { isRecord } from "@/shared/ipc";

const DEFAULT_BASE_URL = "http://localhost:6767";
const REQUEST_TIMEOUT_MS = 15_000;

/** All inteligir memories live under one container tag so a future hosted
 *  (multi-tenant) deployment can scope them per user/device. */
const MEMORY_CONTAINER_TAG = "inteligir";

export type MemoryClientConfig = {
  baseUrl: string;
  /** Optional bearer key — unnecessary for localhost (auto-authenticated),
   *  required when pointing at a remote/hosted instance. */
  apiKey?: string;
};

export function resolveMemoryConfig(env: NodeJS.ProcessEnv = process.env): MemoryClientConfig {
  const apiKey = env["SUPERMEMORY_API_KEY"];
  return {
    baseUrl: (env["SUPERMEMORY_BASE_URL"] ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    ...(apiKey !== undefined ? { apiKey } : {}),
  };
}

/** The server isn't reachable (not installed / not running). Callers turn
 *  this into guidance rather than a stack trace. */
export class MemoryUnavailableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(`supermemory server not reachable at ${baseUrl}`, { cause });
    this.name = "MemoryUnavailableError";
  }
}

// Response shapes, pruned to the fields we render. Verified against the
// supermemory SDK (v4.24) type definitions for /v3/documents, /v4/search,
// /v4/profile, /v4/memories.
export type MemoryAddResult = { id: string; status: string };

type MemorySearchHit = {
  id: string;
  /** Present for memory results. */
  memory?: string | undefined;
  /** Present for chunk results from hybrid/document search. */
  chunk?: string | undefined;
  similarity: number;
};

export type MemorySearchResult = { results: MemorySearchHit[]; total: number };

export type MemoryProfile = { static: string[]; dynamic: string[] };

export type MemoryForgetResult = { id: string; forgotten: boolean };

export type MemoryDocument = {
  id: string;
  title?: string | undefined;
  summary?: string | undefined;
  status?: string | undefined;
};

// ---------------------------------------------------------------------------
// Field narrowing — payloads come from an external process, so every read
// goes through a typeof check instead of a cast.
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export class MemoryClient {
  constructor(private readonly config: MemoryClientConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  /** Store one memory. The server extracts/indexes asynchronously. */
  async add(content: string, metadata?: Record<string, string>): Promise<MemoryAddResult> {
    const raw = await this.request("POST", "/v3/documents", {
      content,
      containerTag: MEMORY_CONTAINER_TAG,
      ...(metadata ? { metadata } : {}),
    });
    return {
      id: asString(raw["id"]) ?? "(unknown)",
      status: asString(raw["status"]) ?? "queued",
    };
  }

  /** Low-latency conversational memory search. */
  async search(query: string, limit = 10): Promise<MemorySearchResult> {
    const raw = await this.request("POST", "/v4/search", {
      q: query,
      containerTag: MEMORY_CONTAINER_TAG,
      limit,
    });
    const results = asRecordArray(raw["results"]).map(
      (hit): MemorySearchHit => ({
        id: asString(hit["id"]) ?? "(unknown)",
        memory: asString(hit["memory"]),
        chunk: asString(hit["chunk"]),
        similarity: typeof hit["similarity"] === "number" ? hit["similarity"] : 0,
      }),
    );
    return {
      results,
      total: typeof raw["total"] === "number" ? raw["total"] : results.length,
    };
  }

  /** Static + dynamic user profile distilled from stored memories. */
  async profile(): Promise<MemoryProfile> {
    const raw = await this.request("POST", "/v4/profile", {
      containerTag: MEMORY_CONTAINER_TAG,
    });
    const profile = isRecord(raw["profile"]) ? raw["profile"] : {};
    return {
      static: asStringArray(profile["static"]),
      dynamic: asStringArray(profile["dynamic"]),
    };
  }

  /** Forget by memory id, or by free-text description of what to forget. */
  async forget(target: {
    id?: string;
    content?: string;
    reason?: string;
  }): Promise<MemoryForgetResult> {
    const raw = await this.request("DELETE", "/v4/memories", {
      containerTag: MEMORY_CONTAINER_TAG,
      ...target,
    });
    return {
      id: asString(raw["id"]) ?? "(unknown)",
      forgotten: raw["forgotten"] === true,
    };
  }

  /** Recently stored documents (raw inputs, not extracted memories). */
  async list(limit = 20): Promise<MemoryDocument[]> {
    const raw = await this.request("POST", "/v3/documents/list", {
      containerTags: [MEMORY_CONTAINER_TAG],
      limit,
      order: "desc",
    });
    return asRecordArray(raw["memories"]).map(
      (doc): MemoryDocument => ({
        id: asString(doc["id"]) ?? "(unknown)",
        title: asString(doc["title"]),
        summary: asString(doc["summary"]),
        status: asString(doc["status"]),
      }),
    );
  }

  private async request(
    method: "POST" | "DELETE",
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // fetch rejects with TypeError on connection refusal and DOMException
      // on timeout — both mean "no usable server", which callers translate
      // into setup guidance.
      throw new MemoryUnavailableError(this.config.baseUrl, err);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`supermemory ${method} ${path} failed (${response.status}): ${detail}`);
    }
    const parsed: unknown = await response.json();
    return isRecord(parsed) ? parsed : {};
  }
}
