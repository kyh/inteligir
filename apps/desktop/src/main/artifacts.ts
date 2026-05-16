// ---------------------------------------------------------------------------
// JsonStore-backed artifacts manager. Persists agent-authored UI panels to
// ~/.inteligir/artifacts.json. List/get/upsert/delete operations are all
// synchronous against the on-disk cache; writes broadcast an
// ARTIFACTS_UPDATED event so open artifact viewers and the library panel
// stay in sync without polling.
// ---------------------------------------------------------------------------

import { z } from "zod";

import { broadcastToRenderer } from "@/main/lib/broadcast";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import { IPC_CHANNELS } from "@/shared/ipc";
import {
  slugifyArtifactId,
  type Artifact,
  type ArtifactsList,
  type ArtifactSpec,
  type ArtifactUpsertInput,
} from "@/shared/artifacts";

// ---------------------------------------------------------------------------
// Schema — loose on spec shape (the renderer's catalog does strict prop
// validation at mount time). Exported so the IPC handler can reuse it.
// ---------------------------------------------------------------------------

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
  id: z.string().optional(),
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

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class ArtifactsManager {
  private readonly store: JsonStore<ArtifactsFile>;

  constructor(storePath?: string) {
    this.store = new JsonStore(
      storePath ?? inteligirPath("artifacts.json"),
      // Schema parse output is structurally compatible with ArtifactsFile —
      // cast away the narrower inferred element type so the generic stays
      // explicit (same pattern as ui-settings used).
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
   * Patch only the `state` of an existing artifact. Used by the renderer to
   * persist user interactions (checkbox toggles, etc.) without touching the
   * agent-owned spec. Returns the updated artifact or null if not found.
   */
  patchState(id: string, state: Record<string, unknown>): Artifact | null {
    let result: Artifact | null = null;
    const next = this.store.update((current) => {
      const idx = current.artifacts.findIndex((a) => a.id === id);
      if (idx === -1) return current;
      const updated: Artifact = {
        ...current.artifacts[idx]!,
        state,
        updatedAt: Date.now(),
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

  invalidate(): void {
    this.store.invalidate();
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
