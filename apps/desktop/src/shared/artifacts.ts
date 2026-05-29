// Shape mirrors json-render's `Spec` so the renderer can hand it to
// <Renderer /> without conversion. Types stay loose here so main/preload
// don't pull @json-render/core into their dep graph.

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

export type ArtifactUpsertInput = {
  id?: string;
  title: string;
  description?: string;
  spec: ArtifactSpec;
  state?: Record<string, unknown>;
};

// RFC 6902 JSON Patch operations. Path is a JSON Pointer rooted at the
// artifact's spec object (e.g. "/elements/button-1/props/label"). The "-"
// segment appends to arrays.
export type ArtifactPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

export type ArtifactPatchInput = {
  id: string;
  ops: ArtifactPatchOp[];
};

// Order matters: strip → slice → strip again. The slice can land mid-run
// and reintroduce a trailing hyphen.
export function slugifyArtifactId(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "artifact";
}
