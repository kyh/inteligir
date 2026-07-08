// ---------------------------------------------------------------------------
// HTML-App broker — the renderer-side half of the runtime bridge. The app runs
// in a sandboxed iframe (no allow-same-origin) and talks to us ONLY by
// postMessage; this module turns a validated `inteligir.files.*` request into
// Bridge calls. It is a NEW capability surface — keep it strictly markdown-file
// ops (list/read/open/create/update/remove); it must NEVER grow raw fs reach.
//
// Two defenses, both required:
//  1. Envelope + token: the VIEW checks `event.source === iframe.contentWindow`
//     and `msg.token === <the token it set as the frame name>` before it ever
//     calls in here (a spoofed frame or stale token is dropped silently).
//  2. Payload validation: every method's args are TypeBox-checked here, and
//     paths are re-rejected for `..` / absolute / scheme-looking shapes BEFORE
//     the Bridge — defense in depth over main's own confinement.
//
// Pure over its deps (no React, no window) so it unit-tests against a fake
// Bridge.
// ---------------------------------------------------------------------------

import { docExists } from "@renderer/lib/bridge";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  applyPropertiesPatch,
  serializeDoc,
  splitFrontmatter,
} from "@repo/core/markdown/frontmatter";
import type { Bridge } from "@repo/features/ipc-registry";

/** The Bridge slice the broker uses — nothing more. */
export type BrokerBridge = Pick<
  Bridge,
  "listVault" | "readVaultDoc" | "writeVaultDoc" | "deleteVaultEntry"
>;

export type BrokerDeps = {
  bridge: BrokerBridge;
  /** Open a note on the workspace's editor surface (vault-context action). */
  openFile: (path: string) => void;
  /** Confirm a destructive remove with the user (returns false to cancel). */
  confirmRemove: (path: string) => Promise<boolean>;
};

// ---- Payload schemas -------------------------------------------------------

const PathArg = Type.String({ minLength: 1 });
const DocInput = Type.Object(
  {
    body: Type.Optional(Type.String()),
    // Property VALUES are unknown (arbitrary yaml); `null` in a patch deletes.
    properties: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

// ---- Path safety (defense in depth over main's confinement) ----------------

function isSafeVaultPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false; // absolute (posix / unc)
  if (/^[a-zA-Z]:/.test(path)) return false; // windows drive
  if (path.includes("\\")) return false; // backslash paths
  if (path.includes("://")) return false; // scheme-looking
  const segments = path.split("/");
  // No `..` traversal and no empty segments (leading/trailing/double slash).
  return !segments.some((seg) => seg === ".." || seg === "");
}

function requireSafePath(value: unknown): string {
  if (!Value.Check(PathArg, value) || !isSafeVaultPath(value)) {
    throw new Error(`invalid vault path: ${String(value)}`);
  }
  return value;
}

function requireDocInput(value: unknown): { body?: string; properties?: Record<string, unknown> } {
  if (!Value.Check(DocInput, value)) throw new Error("invalid document input");
  return value;
}

// ---- Dispatch --------------------------------------------------------------

/** Handle one validated broker request. Throws on any invalid input, unknown
 * method, or downstream failure — the caller maps a throw to an error response.
 */
export async function handleBrokerRequest(
  method: string,
  args: readonly unknown[],
  deps: BrokerDeps,
): Promise<unknown> {
  const { bridge } = deps;
  switch (method) {
    case "list": {
      const entries = await bridge.listVault();
      // Docs only — an app edits notes, not binary assets.
      return entries
        .filter((entry) => entry.kind === "doc")
        .map((entry) => ({ path: entry.path, name: entry.name }));
    }
    case "read": {
      const path = requireSafePath(args[0]);
      const text = await bridge.readVaultDoc({ path });
      const { body, properties } = splitFrontmatter(text);
      return { path, body, properties };
    }
    case "open": {
      const path = requireSafePath(args[0]);
      deps.openFile(path);
      return { opened: path };
    }
    case "create": {
      const path = requireSafePath(args[0]);
      const input = requireDocInput(args[1] ?? {});
      if (await docExists(bridge, path)) throw new Error(`already exists: ${path}`);
      const content = serializeDoc(input.properties ?? {}, input.body ?? "");
      await bridge.writeVaultDoc({ path, content });
      return { path };
    }
    case "update": {
      const path = requireSafePath(args[0]);
      const patch = requireDocInput(args[1] ?? {});
      // Read-modify-write: readVaultDoc throws on a missing file, which surfaces
      // as the request error — update never creates.
      const current = await bridge.readVaultDoc({ path });
      const split = splitFrontmatter(current);
      const nextBody = patch.body !== undefined ? patch.body : split.body;
      const nextProps = patch.properties
        ? applyPropertiesPatch(split.properties, patch.properties)
        : split.properties;
      await bridge.writeVaultDoc({ path, content: serializeDoc(nextProps, nextBody) });
      return { path };
    }
    case "remove": {
      const path = requireSafePath(args[0]);
      const confirmed = await deps.confirmRemove(path);
      if (!confirmed) return { removed: false };
      const result = await bridge.deleteVaultEntry({ path });
      return { removed: result.removed };
    }
    default:
      throw new Error(`unknown method: ${method}`);
  }
}
