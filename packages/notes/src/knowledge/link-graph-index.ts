// Resolution reads only the path set, the docs' `aliases:` and their `id:`, so
// re-projecting a known doc under an unchanged namespace re-resolves its own
// links alone; anything moving a path, alias or id rebuilds whole, because a
// new `note.md` can re-point another doc's dangling `[[note]]`.

import { isDocPath } from "./doc-file";
import type { LinkKind } from "./link-extract";
import { buildResolver, type TargetResolver } from "./link-resolve";
import type { DocProjection, StoredLink } from "./projection";
import { TagIndex, type TagCount } from "./tag-index";
import { basenamePath, extnamePath } from "./vault-path";

export type BacklinkEntry = {
  sourcePath: string;
  line: number;
  snippet: string;
  kind: LinkKind;
  embed: boolean;
  alias?: string;
};

export type ForwardLinkEntry = {
  target: string;
  targetPath: string | null;
  line: number;
  snippet: string;
  kind: LinkKind;
  embed: boolean;
  alias?: string;
  anchor?: string;
};

export type GraphNode = {
  id: string;
  title: string;
  path?: string;
  phantom: boolean;
  degree: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: LinkKind;
  count: number;
};

export type LinkGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type WikiTarget = {
  path: string;
  title: string;
  type: "doc" | "asset";
  aliases?: string[];
  pinned?: boolean;
};

type DocRecord = {
  title: string;
  links: StoredLink[];
  aliases: string[];
  pinned: boolean;
  noteId: string | null;
  /** corpus position, kept across re-projections so an incremental re-file lands in the order a from-scratch build emits */
  seq: number;
};

type ResolvedLink = { link: StoredLink; targetPath: string | null };

type Occurrence = { sourcePath: string; link: StoredLink; seq: number };

type ResolvedState = {
  resolver: TargetResolver;
  forward: Map<string, ResolvedLink[]>;
  backlinks: Map<string, Occurrence[]>;
};

// re-filing is O(docs × out-degree × in-degree) against the fold's O(corpus); 256 is
// the measured crossover for a 20k-doc corpus with a hub every note links to
const MAX_INCREMENTAL_DOCS = 256;

export class LinkGraphIndex {
  private readonly docs = new Map<string, DocRecord>();
  private readonly others = new Set<string>();
  private readonly tagIndex = new TagIndex();
  private resolved: ResolvedState | null = null;
  private readonly pendingDocs = new Set<string>();
  private nextSeq = 0;

  applyDoc(path: string, projection: DocProjection): void {
    this.others.delete(path);
    const prior = this.docs.get(path);
    this.docs.set(path, {
      title: projection.title,
      links: projection.links,
      aliases: projection.aliases,
      pinned: projection.pinned,
      noteId: projection.noteId,
      seq: prior?.seq ?? this.nextSeq++,
    });
    this.tagIndex.set(path, projection.tags);
    if (
      prior !== undefined &&
      sameStrings(prior.aliases, projection.aliases) &&
      prior.noteId === projection.noteId
    ) {
      if (this.resolved !== null) this.pendingDocs.add(path);
    } else {
      this.dropResolution();
    }
  }

  setOther(path: string): void {
    if (this.docs.delete(path)) this.tagIndex.remove(path);
    this.others.add(path);
    this.dropResolution();
  }

  remove(path: string): void {
    const wasDoc = this.docs.delete(path);
    if (wasDoc) this.tagIndex.remove(path);
    const wasOther = this.others.delete(path);
    if (wasDoc || wasOther) this.dropResolution();
  }

  clear(): void {
    this.docs.clear();
    this.others.clear();
    this.tagIndex.clear();
    this.dropResolution();
  }

  titleOf(path: string): string | null {
    return this.docs.get(path)?.title ?? null;
  }

  backlinks(path: string): BacklinkEntry[] {
    const occurrences = this.ensureResolved().backlinks.get(path) ?? [];
    return occurrences.map(({ sourcePath, link }) => {
      const entry: BacklinkEntry = {
        sourcePath,
        line: link.line,
        snippet: link.snippet,
        kind: link.kind,
        embed: link.embed,
      };
      if (link.alias !== undefined) entry.alias = link.alias;
      return entry;
    });
  }

  forwardLinks(path: string): ForwardLinkEntry[] {
    const links = this.ensureResolved().forward.get(path) ?? [];
    return links.map(({ link, targetPath }) => {
      const entry: ForwardLinkEntry = {
        target: link.target,
        targetPath,
        line: link.line,
        snippet: link.snippet,
        kind: link.kind,
        embed: link.embed,
      };
      if (link.alias !== undefined) entry.alias = link.alias;
      if (link.anchor !== undefined) entry.anchor = link.anchor;
      return entry;
    });
  }

  graph(): LinkGraph {
    const { forward } = this.ensureResolved();
    const nodes = new Map<string, GraphNode>();
    for (const [path, record] of this.docs) {
      nodes.set(path, { id: path, title: record.title, path, phantom: false, degree: 0 });
    }
    const edges: GraphEdge[] = [];
    // scoped per source on purpose: one vault-wide map keyed on a path pair is ~50% slower at 400k links
    const bySource = new Map<string, GraphEdge>();
    for (const [sourcePath, links] of forward) {
      bySource.clear();
      const sourceNode = nodes.get(sourcePath);
      for (const { link, targetPath } of links) {
        // a notes graph: asset references stay out so it does not silt up with attachment leaves; backlinks() still answers them
        if (link.kind === "image") continue;
        let targetId: string;
        if (targetPath !== null) {
          if (!this.docs.has(targetPath)) continue; // resolved asset target
          targetId = targetPath;
        } else {
          // a dangling target with a non-doc extension is an asset reference, not a phantom note
          const ext = extnamePath(link.target);
          if (ext !== "" && !isDocPath(link.target)) continue;
          targetId = `phantom:${link.target.toLowerCase()}`;
          if (!nodes.has(targetId)) {
            nodes.set(targetId, { id: targetId, title: link.target, phantom: true, degree: 0 });
          }
        }
        const key = `${link.kind}\u0000${targetId}`;
        const seen = bySource.get(key);
        if (seen !== undefined) {
          seen.count += 1;
          continue;
        }
        const edge: GraphEdge = { source: sourcePath, target: targetId, kind: link.kind, count: 1 };
        bySource.set(key, edge);
        edges.push(edge);
        // degree counts edges, not link occurrences; a self-edge counts once
        if (sourceNode) sourceNode.degree += 1;
        if (targetId !== sourcePath) {
          const targetNode = nodes.get(targetId);
          if (targetNode) targetNode.degree += 1;
        }
      }
    }
    return { nodes: [...nodes.values()], edges };
  }

  wikiTargets(): WikiTarget[] {
    const docs: WikiTarget[] = [];
    for (const [path, record] of this.docs) {
      const target: WikiTarget = { path, title: record.title, type: "doc" };
      if (record.aliases.length > 0) target.aliases = record.aliases;
      if (record.pinned) target.pinned = true;
      docs.push(target);
    }
    const assets = [...this.others].map((path): WikiTarget => ({
      path,
      title: basenamePath(path),
      type: "asset",
    }));
    return [...docs.toSorted(byPath), ...assets.toSorted(byPath)];
  }

  tags(): TagCount[] {
    return this.tagIndex.all();
  }

  tagsOf(path: string): string[] {
    return this.tagIndex.tagsOf(path);
  }

  notesWithTag(tag: string): string[] {
    return this.tagIndex.notesWithTag(tag);
  }

  private dropResolution(): void {
    this.resolved = null;
    this.pendingDocs.clear();
  }

  private ensureResolved(): ResolvedState {
    const current = this.resolved;
    if (current !== null && this.applyPending(current)) return current;
    const aliasEntries: Array<readonly [string, string]> = [];
    for (const [path, record] of this.docs) {
      for (const alias of record.aliases) aliasEntries.push([alias, path]);
    }
    const idEntries: Array<readonly [string, string]> = [];
    for (const [path, record] of this.docs) {
      if (record.noteId !== null) idEntries.push([record.noteId, path]);
    }
    const resolver = buildResolver([...this.docs.keys(), ...this.others], aliasEntries, idEntries);
    const forward = new Map<string, ResolvedLink[]>();
    const backlinks: ResolvedState["backlinks"] = new Map();
    for (const [sourcePath, record] of this.docs) {
      const resolvedLinks = this.resolveLinks(resolver, sourcePath, record);
      forward.set(sourcePath, resolvedLinks);
      for (const { link, targetPath } of resolvedLinks) {
        if (targetPath === null) continue;
        const list = backlinks.get(targetPath);
        const occurrence: Occurrence = { sourcePath, link, seq: record.seq };
        if (list) list.push(occurrence);
        else backlinks.set(targetPath, [occurrence]);
      }
    }
    this.resolved = { resolver, forward, backlinks };
    this.pendingDocs.clear();
    return this.resolved;
  }

  private resolveLinks(
    resolver: TargetResolver,
    sourcePath: string,
    record: DocRecord,
  ): ResolvedLink[] {
    return record.links.map((link) => ({
      link,
      targetPath:
        link.kind === "wiki"
          ? resolver.resolveWiki(link.target, link.alias)
          : resolver.resolveMd(link.target, sourcePath),
    }));
  }

  // false means rebuild: too many pending, or a doc with no prior forward entry, whose position among the occurrences is unknown
  private applyPending(state: ResolvedState): boolean {
    if (this.pendingDocs.size === 0) return true;
    if (this.pendingDocs.size > MAX_INCREMENTAL_DOCS) return false;
    for (const path of this.pendingDocs) {
      const record = this.docs.get(path);
      const stale = state.forward.get(path);
      if (record === undefined || stale === undefined) return false;
      const touched = new Set<string>();
      for (const { targetPath } of stale) {
        if (targetPath !== null) touched.add(targetPath);
      }
      for (const target of touched) {
        const kept = state.backlinks.get(target)?.filter((o) => o.sourcePath !== path);
        if (kept === undefined) continue;
        if (kept.length === 0) state.backlinks.delete(target);
        else state.backlinks.set(target, kept);
      }
      const links = this.resolveLinks(state.resolver, path, record);
      state.forward.set(path, links);
      for (const { link, targetPath } of links) {
        if (targetPath === null) continue;
        fileOccurrence(state.backlinks, targetPath, { sourcePath: path, link, seq: record.seq });
      }
    }
    this.pendingDocs.clear();
    return true;
  }
}

// equal seqs append after each other (the `<=`), matching a from-scratch build's order
function fileOccurrence(
  backlinks: Map<string, Occurrence[]>,
  target: string,
  occurrence: Occurrence,
): void {
  const list = backlinks.get(target);
  if (list === undefined) {
    backlinks.set(target, [occurrence]);
    return;
  }
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const at = list[mid];
    if (at !== undefined && at.seq <= occurrence.seq) low = mid + 1;
    else high = mid;
  }
  list.splice(low, 0, occurrence);
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}

function byPath(a: WikiTarget, b: WikiTarget): number {
  return a.path < b.path ? -1 : 1;
}
