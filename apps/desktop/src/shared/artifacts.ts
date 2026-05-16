// ---------------------------------------------------------------------------
// Artifacts — agent-authored JSON UI panels (think Claude's artifacts).
//
// Each artifact is a json-render flat spec (`{ root, elements }`) plus an
// optional state model that persists across re-opens. The agent owns the
// spec via the `manage_artifacts` tool; the user can open or remove
// artifacts but does not hand-edit the JSON.
//
// Spec/element shape mirrors json-render's `Spec` exactly so the renderer
// can hand it to `<Renderer />` without conversion. We keep the type loose
// in shared code (no @json-render/core import) so main + preload don't pull
// the renderer dep graph in.
// ---------------------------------------------------------------------------

export type ArtifactSpecElement = {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
  visible?: unknown;
  on?: Record<string, unknown>;
  watch?: Record<string, unknown>;
};

export type ArtifactSpec = {
  root: string;
  elements: Record<string, ArtifactSpecElement>;
  state?: Record<string, unknown>;
};

export type Artifact = {
  id: string;
  title: string;
  description?: string;
  spec: ArtifactSpec;
  state: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type ArtifactsList = {
  artifacts: Artifact[];
};

// Upsert input — `id` chooses create-vs-update. If omitted on create, the
// store generates one from the title. `state` is optional; omitting it keeps
// the existing state on update, or seeds {} on create.
export type ArtifactUpsertInput = {
  id?: string;
  title: string;
  description?: string;
  spec: ArtifactSpec;
  state?: Record<string, unknown>;
};

/**
 * Slugify a title into a stable artifact id. Lowercase, hyphenated, ASCII,
 * trimmed, max 48 chars. Returns "artifact" if nothing usable remains.
 */
export function slugifyArtifactId(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "artifact";
}
