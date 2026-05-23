// Persistence layer for agent-authored UI panels at ~/.inteligir/artifacts.json.
// Spec validation is loose here — the renderer catalog does strict prop-shape
// checking at mount time.

import { z } from "zod";

import { broadcastToRenderer } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import {
  slugifyArtifactId,
  type Artifact,
  type ArtifactPatchInput,
  type ArtifactPatchOp,
  type ArtifactsList,
  type ArtifactSpec,
  type ArtifactUpsertInput,
} from "@/shared/artifacts";
import { IPC_CHANNELS } from "@/shared/ipc";
import { parsePointer, PROTO_RESERVED } from "@/shared/json-pointer";

const ElementSchema = z.looseObject({
  type: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).optional(),
});

export const ArtifactSpecSchema = z.object({
  root: z.string(),
  elements: z.record(z.string(), ElementSchema),
  state: z.record(z.string(), z.unknown()).optional(),
});

const ArtifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  spec: ArtifactSpecSchema,
  state: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const ArtifactsFileSchema = z.object({
  version: z.literal(1),
  artifacts: z.array(ArtifactSchema),
});

export const ArtifactUpsertInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  spec: ArtifactSpecSchema,
  state: z.record(z.string(), z.unknown()).optional(),
});

type ArtifactsFile = {
  version: 1;
  artifacts: Artifact[];
};

const DEFAULTS: ArtifactsFile = { version: 1, artifacts: [] };

export class ArtifactsManager {
  private readonly store: JsonStore<ArtifactsFile>;

  constructor(storePath?: string) {
    this.store = new JsonStore(
      storePath ?? inteligirPath("artifacts.json"),
      // Cast: Zod's inferred element type is narrower than ArtifactsFile.
      ArtifactsFileSchema as unknown as z.ZodType<ArtifactsFile>,
      DEFAULTS,
    );
  }

  list(): ArtifactsList {
    return { artifacts: [...this.store.read().artifacts] };
  }

  get(id: string): Artifact | null {
    return this.store.read().artifacts.find((a) => a.id === id) ?? null;
  }

  upsert(input: ArtifactUpsertInput): Artifact {
    const now = Date.now();
    let result: Artifact | null = null;
    const next = this.store.update((current) => {
      const id = input.id ?? this.allocateId(current.artifacts, input.title);
      const existing = current.artifacts.find((a) => a.id === id);
      const artifact: Artifact = existing
        ? {
            ...existing,
            title: input.title,
            description: input.description ?? existing.description,
            spec: input.spec,
            // Preserve existing state by default — only replace when the
            // caller explicitly passes one (e.g. agent reseeding bindings).
            state: input.state ?? existing.state,
            updatedAt: now,
          }
        : {
            id,
            title: input.title,
            description: input.description,
            spec: input.spec,
            state: input.state ?? input.spec.state ?? {},
            createdAt: now,
            updatedAt: now,
          };
      result = artifact;
      const others = current.artifacts.filter((a) => a.id !== id);
      return { ...current, artifacts: [...others, artifact] };
    });
    this.broadcast(next);
    if (!result) throw new Error("upsert failed to produce an artifact");
    return result;
  }

  /**
   * Apply RFC 6902 patch operations to an existing artifact's spec. Paths are
   * JSON Pointers rooted at the spec object (e.g. "/elements/btn/props/label").
   * The result is validated against ArtifactSpecSchema before being written —
   * an invalid patch throws and the existing spec is unchanged.
   */
  patch(input: ArtifactPatchInput): Artifact {
    const existing = this.get(input.id);
    if (!existing) throw new Error(`No artifact with id '${input.id}'`);
    const draft = deepClone(existing.spec);
    for (const op of input.ops) applyPatchOp(draft, op);
    // Use the parse RESULT, not the draft — the schema's defaults (e.g.
    // props: {}) only apply through parse output, so writing the raw draft
    // would let normalizations slip past validation.
    const validated = ArtifactSpecSchema.parse(draft) as ArtifactSpec;
    return this.upsert({
      id: existing.id,
      title: existing.title,
      description: existing.description,
      spec: validated,
      state: existing.state,
    });
  }

  /**
   * Merge a sparse pointer-keyed patch into an artifact's state. Patch keys
   * are JSON Pointers rooted at the state object, values are the new leaf
   * values. Used by the renderer to persist user interactions without
   * touching paths the agent set concurrently.
   *
   * A full-replacement patchState would race agent updates: if the agent
   * writes new state keys while a renderer debounce is in flight, the
   * later-arriving full snapshot would clobber the agent's keys.
   *
   * NOT bumping updatedAt is deliberate. `state` is transient session data
   * (user-driven bound inputs) — bumping updatedAt on every keystroke
   * defeats the artifacts-store dedup at the library level and ticks the
   * "Updated Nm ago" label on every paste. The renderer-side viewer
   * subscribes to ARTIFACTS_UPDATED separately, so it still gets the
   * broadcast and updates its baseline; only the library short-circuits.
   */
  patchState(id: string, patch: Record<string, unknown>): Artifact | null {
    let result: Artifact | null = null;
    const next = this.store.update((current) => {
      const idx = current.artifacts.findIndex((a) => a.id === id);
      if (idx === -1) return current;
      const draft = deepClone(current.artifacts[idx]!.state);
      for (const [pointer, value] of Object.entries(patch)) {
        setByPointer(draft, pointer, value);
      }
      const updated: Artifact = {
        ...current.artifacts[idx]!,
        state: draft,
      };
      result = updated;
      const artifacts = [...current.artifacts];
      artifacts[idx] = updated;
      return { ...current, artifacts };
    });
    if (result) this.broadcast(next);
    return result;
  }

  delete(id: string): boolean {
    let deleted = false;
    const next = this.store.update((current) => {
      const before = current.artifacts.length;
      const artifacts = current.artifacts.filter((a) => a.id !== id);
      deleted = artifacts.length !== before;
      return { ...current, artifacts };
    });
    if (deleted) this.broadcast(next);
    return deleted;
  }

  /**
   * Drop the cached state and broadcast the post-invalidate read so the
   * renderer's singleton store stays in sync. Called from teardownResources()
   * after AGENT_DIR is wiped on logout — the read returns the empty default.
   */
  invalidate(): void {
    this.store.invalidate();
    this.broadcast(this.store.read());
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private allocateId(existing: Artifact[], title: string): string {
    const base = slugifyArtifactId(title);
    const taken = new Set(existing.map((a) => a.id));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 1_000_000; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    // Pathological: fall back to a timestamp suffix.
    return `${base}-${Date.now()}`;
  }

  private broadcast(file: ArtifactsFile): void {
    broadcastToRenderer(IPC_CHANNELS.ARTIFACTS_UPDATED, {
      artifacts: file.artifacts,
    } satisfies ArtifactsList);
  }
}

// Re-export the ArtifactSpec type alias for handler typing.
export type { ArtifactSpec };

let _instance: ArtifactsManager | null = null;

export function getArtifacts(): ArtifactsManager {
  if (!_instance) _instance = new ArtifactsManager();
  return _instance;
}

export function resetArtifactsCache(): void {
  _instance?.invalidate();
}

// ---------------------------------------------------------------------------
// RFC 6902 JSON Patch — minimal in-place implementations for spec + state.
// ---------------------------------------------------------------------------

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertSafeKey(key: string, pointer: string, verb: string): void {
  if (PROTO_RESERVED.has(key)) {
    throw new Error(`Refusing to ${verb} prototype-reserved key '${key}' in ${pointer}`);
  }
}

// Merge a sparse value into nested state, creating intermediate objects as
// needed. patchState uses this so user-driven state changes don't touch
// paths the agent set concurrently.
function setByPointer(target: Record<string, unknown>, pointer: string, value: unknown): void {
  const segments = parsePointer(pointer);
  if (segments.length === 0) throw new Error("Cannot set state root via patchState");
  let current: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    assertSafeKey(seg, pointer, "traverse");
    const child = current[seg];
    if (child === null || typeof child !== "object" || Array.isArray(child)) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1]!;
  assertSafeKey(last, pointer, "set");
  current[last] = value;
}

function applyPatchOp(root: ArtifactSpec, op: ArtifactPatchOp): void {
  const segments = parsePointer(op.path);
  if (segments.length === 0) {
    throw new Error("Cannot patch the artifact spec root — use update instead");
  }
  let parent: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (Array.isArray(parent)) {
      const idx = Number.parseInt(seg, 10);
      if (Number.isNaN(idx)) throw new Error(`Bad array index '${seg}' in ${op.path}`);
      parent = parent[idx];
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
    const idx = last === "-" ? parent.length : Number.parseInt(last, 10);
    if (Number.isNaN(idx)) throw new Error(`Bad array index '${last}' in ${op.path}`);
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
