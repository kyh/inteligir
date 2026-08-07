// ---------------------------------------------------------------------------
// Payload schemas are EXACT. Every object schema the registry can validate
// against carries `additionalProperties: false`, so a field the host does not
// know about is a refusal rather than a silent drop.
//
// Without this, a channel written without the flag typechecks, lints, passes
// knip and passes every other suite — and the dropped field surfaces as a
// behaviour bug in a client, a long way from the entry that caused it. The
// registry's own doc calls exactness an invariant; this is what makes that
// word true. It found `readChatSession` the first time it ran.
//
// Union members count: `Type.Union([...])` emits `anyOf`, and a loose member
// admits excess fields exactly as a loose top-level object would. Payloads that
// are not objects at all — a bare id string, the payload-free `Type.Undefined`,
// the binary audio frame's `Type.Unknown` — have no excess properties to admit
// and are simply not in scope.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { IPC, IPC_METHODS, type IpcMethod } from "../ipc-registry";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every object schema a payload can validate against: the schema itself, plus
 * each member of a union. */
function objectSchemas(schema: unknown, out: Record<string, unknown>[]): void {
  if (!isRecord(schema)) return;
  if (schema["type"] === "object") out.push(schema);
  const members = schema["anyOf"];
  if (Array.isArray(members)) for (const member of members) objectSchemas(member, out);
}

function payloadObjects(method: IpcMethod): Record<string, unknown>[] {
  const entry: unknown = IPC[method];
  if (!isRecord(entry) || !("payload" in entry)) return [];
  const found: Record<string, unknown>[] = [];
  objectSchemas(entry.payload, found);
  return found;
}

describe("registry payload schemas", () => {
  it("every object schema a payload validates against is exact", () => {
    const loose = IPC_METHODS.filter((method) =>
      payloadObjects(method).some((schema) => schema["additionalProperties"] !== false),
    );

    expect(
      loose,
      "these payload schemas admit unknown fields — add `{ additionalProperties: false }`,\n" +
        "or the host silently drops what a client sends:\n" +
        loose.map((method) => `  ${method}`).join("\n"),
    ).toEqual([]);
  });

  // A floor, so a registry refactor that stops the walk finding anything cannot
  // make the assertion above vacuously green.
  it("finds the object-payload channels at all", () => {
    const total = IPC_METHODS.reduce((sum, method) => sum + payloadObjects(method).length, 0);
    expect(total).toBeGreaterThanOrEqual(20);
  });
});
