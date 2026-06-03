// RFC 6901 JSON Pointer + RFC 6902 JSON Patch helpers, shared so the same
// (prototype-pollution-guarded) patch applier serves any agent-authored
// payload. Kept hand-rolled rather than using @json-render/core's applier,
// which has no prototype-key guard.

import { type Static, Type } from "@sinclair/typebox";

// Object keys we refuse to traverse or write — letting an LLM-supplied path
// land here would let it mutate Object.prototype.
const PROTO_RESERVED = new Set(["__proto__", "constructor", "prototype"]);

function parsePointer(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer (must start with /): ${path}`);
  }
  return path
    .slice(1)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

// TypeBox is the source of truth — the agent tool consumes this as its JSON
// Schema and the TypeScript type derives via Static.
export const JsonPatchOpParam = Type.Union([
  Type.Object(
    { op: Type.Literal("add"), path: Type.String(), value: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object(
    { op: Type.Literal("replace"), path: Type.String(), value: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object({ op: Type.Literal("remove"), path: Type.String() }, { additionalProperties: false }),
]);

export type JsonPatchOp = Static<typeof JsonPatchOpParam>;

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Apply one RFC 6902 op to `root` in place. Refuses prototype-reserved keys
 * and non-canonical / out-of-bounds array indices. */
export function applyJsonPatchOp(root: unknown, op: JsonPatchOp): void {
  const segments = parsePointer(op.path);
  if (segments.length === 0) {
    throw new Error("Cannot patch the document root — replace the whole value instead");
  }
  let parent: unknown = root;
  const pathToParent = segments.slice(0, -1);
  for (const [i, seg] of pathToParent.entries()) {
    if (Array.isArray(parent)) {
      parent = parent[parseArrayIndex(seg, op.path)];
    } else if (isObjectRecord(parent)) {
      assertSafeKey(seg, op.path, "traverse");
      parent = parent[seg];
    } else {
      throw new Error(`${op.path} traverses non-container at segment ${i}`);
    }
    if (parent === undefined) {
      throw new Error(`${op.path} does not exist (missing segment '${seg}')`);
    }
  }
  const last = segments.at(-1);
  if (last === undefined) throw new Error(`Invalid JSON Pointer: ${op.path}`);
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
  } else if (isObjectRecord(parent)) {
    assertSafeKey(last, op.path, op.op);
    if (op.op === "add" || op.op === "replace") parent[last] = op.value;
    else delete parent[last];
  } else {
    throw new Error(`Cannot ${op.op} at ${op.path}: parent is not a container`);
  }
}
