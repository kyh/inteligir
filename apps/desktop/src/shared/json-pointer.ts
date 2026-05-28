// RFC 6901 JSON Pointer helpers for spec-patch application in the main process.

// Object keys we refuse to traverse or write — letting an LLM-supplied path
// land here would let it mutate Object.prototype.
export const PROTO_RESERVED = new Set(["__proto__", "constructor", "prototype"]);

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
