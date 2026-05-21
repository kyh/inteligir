// RFC 6901 JSON Pointer helpers. Shared between main (patch application) and
// renderer (state diff flattening) so the escape/unescape pair can't drift.

// Object keys we refuse to traverse or write — letting an LLM-supplied path
// land here would let it mutate Object.prototype.
export const PROTO_RESERVED = new Set(["__proto__", "constructor", "prototype"]);

export function escapeSegment(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function parsePointer(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer (must start with /): ${path}`);
  }
  return path
    .slice(1)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}
