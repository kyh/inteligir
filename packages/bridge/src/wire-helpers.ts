// ---------------------------------------------------------------------------
// Small helpers shared across the IPC seam (host, transports, renderer,
// mobile): error stringification, wire-value guards, message-text extraction.
// The channel-and-schema registry — and every type that flows through it —
// lives with its domain module (./vault, ./knowledge, …); import those directly.
// ---------------------------------------------------------------------------

/**
 * True for a non-null, non-array object — narrows `unknown` before indexing its
 * keys. The single definition app-wide: every wire boundary (IPC frames, HTTP
 * payloads, stored JSON) parses through it, and nothing on a wire is trusted.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse stored or received JSON into `unknown`, answering `undefined` for text
 * that is not JSON at all.
 *
 * A VALUE rather than a throw, because every caller of this is about to check
 * the SHAPE and already has a fallback for a shape it cannot read. Bare
 * `JSON.parse` splits that one fact in two — unparseable throws, wrong-shaped
 * returns — and the throw escapes past the fallback the caller wrote for it.
 * `undefined` fails every schema check, so the two arrive at the same branch.
 */
export function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Human-readable message for a caught value. A non-Error throw stringifies —
 * or, when `fallback` is given, yields the fallback instead (for UI surfaces
 * where a raw stringified value would read worse than a canned sentence). */
export function toErrorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Concatenated text blocks of a message `content` value — a plain string, or
 * an array of pi-ai content blocks (only `{type:"text"}` blocks contribute). */
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block["type"] === "text") {
      const text = block["text"];
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("");
}

export function extractText(message: unknown): string {
  if (!isRecord(message)) return "";
  return extractTextFromContent(message["content"]);
}
