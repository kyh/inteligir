// The vault/knowledge channels that carry a single `path`. Two schemas serve
// them — NotePathSchema (a markdown note) and the kind-agnostic VaultPathSchema
// — and the split exists to describe the argument, NOT to validate it
// differently. These tests pin both halves of that: identical structure once
// descriptions are stripped, and identical Value.Check verdicts.

import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

import { isRecord } from "../wire-helpers";
import { IPC, NotePathSchema } from "../ipc-registry";

/** The wire shape every path channel emits. Descriptions are stripped before
 * the compare, so adding model-facing prose can never masquerade as a
 * validation change — anything else showing up here IS one. */
const PATH_PAYLOAD = {
  type: "object",
  properties: { path: { type: "string" } },
  required: ["path"],
  additionalProperties: false,
};

function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "description")
      .map(([key, inner]) => [key, stripDescriptions(inner)]),
  );
}

/** JSON-serialize (dropping TypeBox's symbol Kind markers), then drop every
 * `description` key at any depth. */
function structureOf(schema: TSchema): unknown {
  const json: unknown = JSON.parse(JSON.stringify(schema));
  return stripDescriptions(json);
}

const NOTE_PATH_CHANNELS = [
  IPC.probeNotePrivacy,
  IPC.getBacklinks,
  IPC.getForwardLinks,
  IPC.getRelatedNotes,
];

const VAULT_PATH_CHANNELS = [
  IPC.readVaultDoc,
  IPC.getVaultFileFacts,
  IPC.deleteVaultEntry,
  IPC.readVaultAsset,
];

describe("single-path vault channel payloads", () => {
  it("validate identically — the split is prose, not shape", () => {
    for (const channel of [...NOTE_PATH_CHANNELS, ...VAULT_PATH_CHANNELS]) {
      expect(structureOf(channel.payload)).toEqual(PATH_PAYLOAD);
    }
  });

  it("describes the argument for a model on both schemas", () => {
    for (const channel of [...NOTE_PATH_CHANNELS, ...VAULT_PATH_CHANNELS]) {
      const properties = channel.payload["properties"];
      const path: unknown = isRecord(properties) ? properties["path"] : undefined;
      const description: unknown = isRecord(path) ? path["description"] : undefined;
      expect(typeof description).toBe("string");
    }
  });

  it("accepts a relative path and refuses anything else", () => {
    for (const channel of [...NOTE_PATH_CHANNELS, ...VAULT_PATH_CHANNELS]) {
      expect(Value.Check(channel.payload, { path: "notes/ideas.md" })).toBe(true);
      expect(Value.Check(channel.payload, {})).toBe(false);
      expect(Value.Check(channel.payload, { path: 1 })).toBe(false);
      expect(Value.Check(channel.payload, { path: "a.md", extra: true })).toBe(false);
    }
  });

  it("hands the knowledge channels the schema the agent tools import", () => {
    for (const channel of NOTE_PATH_CHANNELS) {
      expect(channel.payload).toBe(NotePathSchema);
    }
  });
});
