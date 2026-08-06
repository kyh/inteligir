// ---------------------------------------------------------------------------
// The two provider wire formats, as pure functions.
//
// The editor's AI runs as a DIRECT provider call from the Durable Object, not
// through the container — a ⌘J generation and a ghost completion are
// latency-sensitive text turns with no tools, and routing one through a
// container would pay a cold start (the container's ordinary state) for a
// request that needs nothing the container has. The sandbox stays for
// TOOL-USING turns, where the filesystem and the shell are the point.
//
// So this Worker has to speak the provider's HTTP API itself, and that is all
// this module is: build a request body, read a reply, read one streamed delta.
// It is pure over a `ProviderEntry` so every shape decision is unit-testable
// without a credential, a network or a Durable Object — the same split
// ../agent/egress.ts keeps for the container's credential injection.
//
// The wire is a property of the CATALOG ENTRY, never of the model id: a
// deployment pointing `baseUrl` at a gateway still speaks whichever of the two
// formats the entry declares, and a model list that grows never touches this
// file.
// ---------------------------------------------------------------------------

import { isRecord } from "@repo/bridge/wire-helpers";

import type { ProviderEntry } from "../agent/provider-catalog";

/** One completion request, as this Worker will send it. */
export type CompletionRequest = {
  readonly url: string;
  readonly body: string;
};

export type CompletionParams = {
  readonly modelId: string;
  /** The fully-formed prompt. The editor composes it (action + selection +
   * context) and the host never rewrites it — a host that edited the prompt
   * would make the editor's own preview a lie. */
  readonly prompt: string;
  readonly maxTokens: number;
  readonly stream: boolean;
};

/** Build the completion request `entry` expects. */
export function buildCompletionRequest(
  entry: ProviderEntry,
  params: CompletionParams,
): CompletionRequest {
  if (entry.wire === "anthropic") {
    return {
      url: `${entry.baseUrl}/messages`,
      body: JSON.stringify({
        model: params.modelId,
        max_tokens: params.maxTokens,
        stream: params.stream,
        messages: [{ role: "user", content: params.prompt }],
      }),
    };
  }
  return {
    url: `${entry.baseUrl}/chat/completions`,
    body: JSON.stringify({
      model: params.modelId,
      // `max_completion_tokens` rather than the deprecated `max_tokens`: the
      // reasoning-model families reject the old name outright.
      max_completion_tokens: params.maxTokens,
      stream: params.stream,
      messages: [{ role: "user", content: params.prompt }],
    }),
  };
}

/** The headers a completion request carries, given a minted bearer. The
 * credential header is the entry's own, so the direct call and the container's
 * intercepted one authenticate identically. */
export function completionHeaders(entry: ProviderEntry, token: string): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set(entry.auth.header, `${entry.auth.prefix}${token}`);
  for (const [name, value] of Object.entries(entry.extraHeaders)) headers.set(name, value);
  return headers;
}

/**
 * The assistant text in a non-streamed reply, or `""` when the reply carried
 * none.
 *
 * Empty is a VALUE rather than a throw: a provider that answers with a refusal
 * block, a tool call or a stop-reason-only body is not a transport failure, and
 * the caller already has a "no response" sentence for it.
 */
export function readCompletionText(entry: ProviderEntry, payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (entry.wire === "anthropic") {
    const content = payload["content"];
    if (!Array.isArray(content)) return "";
    let text = "";
    for (const block of content) {
      if (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string") {
        text += block["text"];
      }
    }
    return text;
  }
  const choices = payload["choices"];
  if (!Array.isArray(choices)) return "";
  const first: unknown = choices[0];
  if (!isRecord(first)) return "";
  const message = first["message"];
  if (!isRecord(message)) return "";
  const content = message["content"];
  return typeof content === "string" ? content : "";
}

/** One SSE `data:` payload's text delta, or `""` when the event carries none
 * (a ping, a message-start, a usage frame). */
export function readStreamDelta(entry: ProviderEntry, data: string): string {
  if (data === "[DONE]") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return "";
  }
  if (!isRecord(parsed)) return "";
  if (entry.wire === "anthropic") {
    if (parsed["type"] !== "content_block_delta") return "";
    const delta = parsed["delta"];
    if (!isRecord(delta) || delta["type"] !== "text_delta") return "";
    return typeof delta["text"] === "string" ? delta["text"] : "";
  }
  const choices = parsed["choices"];
  if (!Array.isArray(choices)) return "";
  const first: unknown = choices[0];
  if (!isRecord(first)) return "";
  const delta = first["delta"];
  if (!isRecord(delta)) return "";
  const content = delta["content"];
  return typeof content === "string" ? content : "";
}

/**
 * Split an SSE buffer into its complete `data:` payloads and whatever is left
 * over.
 *
 * A chunked read splits mid-event constantly, so the remainder has to come back
 * to the caller rather than be dropped — a swallowed tail is a completion
 * missing its last words, which reads as a model that trailed off.
 */
export function drainSseEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  // Both terminators, because a provider that emits CRLF is within the spec and
  // splitting on "\n\n" alone would leave a stray \r on every field.
  const normalized = buffer.replaceAll("\r\n", "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let data = "";
    for (const line of part.split("\n")) {
      if (!line.startsWith("data:")) continue;
      // Exactly one optional leading space is part of the field, per the spec;
      // trimming more would eat indentation a JSON payload never has anyway.
      data += line.slice(5).replace(/^ /, "");
    }
    if (data !== "") events.push(data);
  }
  return { events, rest };
}
