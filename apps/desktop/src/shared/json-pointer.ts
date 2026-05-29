// RFC 6901 JSON Pointer + RFC 6902 JSON Patch helpers, shared so the same
// (prototype-pollution-guarded) patch applier serves any agent-authored
// payload. Kept hand-rolled rather than using @json-render/core's applier,
// which has no prototype-key guard.

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

export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

function assertSafeKey(key: string, pointer: string, verb: string): void {
  if (PROTO_RESERVED.has(key)) {
    throw new Error(`Refusing to ${verb} prototype-reserved key '${key}' in ${pointer}`);
  }
}

// RFC 6901 array indices must be canonical: "0" or a non-zero-leading run of
// digits. Number.parseInt would accept "01", "1x", " 2", aliasing a bad patch
// onto the wrong slot instead of rejecting it.
function parseArrayIndex(seg: string, pointer: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(seg)) {
    throw new Error(`Bad array index '${seg}' in ${pointer}`);
  }
  return Number.parseInt(seg, 10);
}

/** Apply one RFC 6902 op to `root` in place. Refuses prototype-reserved keys
 * and non-canonical / out-of-bounds array indices. */
export function applyJsonPatchOp(root: unknown, op: JsonPatchOp): void {
  const segments = parsePointer(op.path);
  if (segments.length === 0) {
    throw new Error("Cannot patch the document root — replace the whole value instead");
  }
  let parent: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (Array.isArray(parent)) {
      parent = parent[parseArrayIndex(seg, op.path)];
    } else if (parent !== null && typeof parent === "object") {
      assertSafeKey(seg, op.path, "traverse");
      parent = (parent as Record<string, unknown>)[seg];
    } else {
      throw new Error(`${op.path} traverses non-container at segment ${i}`);
    }
    if (parent === undefined) {
      throw new Error(`${op.path} does not exist (missing segment '${segments[i]}')`);
    }
  }
  const last = segments[segments.length - 1]!;
  if (Array.isArray(parent)) {
    if (last === "-" && op.op !== "add") {
      throw new Error(`'-' index is only valid for add in ${op.path}`);
    }
    const idx = last === "-" ? parent.length : parseArrayIndex(last, op.path);
    if (op.op === "add") {
      if (idx < 0 || idx > parent.length) {
        throw new Error(`Array index ${idx} out of bounds for add in ${op.path}`);
      }
      parent.splice(idx, 0, op.value);
    } else if (op.op === "replace") {
      if (idx < 0 || idx >= parent.length) {
        throw new Error(`Array index ${idx} out of bounds for replace in ${op.path}`);
      }
      parent[idx] = op.value;
    } else {
      if (idx < 0 || idx >= parent.length) {
        throw new Error(`Array index ${idx} out of bounds for remove in ${op.path}`);
      }
      parent.splice(idx, 1);
    }
  } else if (parent !== null && typeof parent === "object") {
    assertSafeKey(last, op.path, op.op);
    const obj = parent as Record<string, unknown>;
    if (op.op === "add" || op.op === "replace") obj[last] = op.value;
    else delete obj[last];
  } else {
    throw new Error(`Cannot ${op.op} at ${op.path}: parent is not a container`);
  }
}
