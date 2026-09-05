// Derived from the resolved graph alone, never a scan: a dangling target is the resolver's
// verdict, and an orphan is a doc with no in-edge, so every row disappears with the sweep
// that fixes it. Each family is capped on its own; the totals say what the cap hid.

import { DAILY_NOTES_FOLDER, TEMPLATES_FOLDER } from "../templates/placeholders";
import { docStem, isDocPath } from "./doc-file";
import type { LinkKind } from "./link-extract";
import type { BacklinkEntry, ForwardLinkEntry, WikiTarget } from "./link-graph-index";
import { extnamePath } from "./vault-path";

export type UnresolvedLinkRow = {
  sourcePath: string;
  sourceTitle: string;
  target: string;
  line: number;
  snippet: string;
  kind: LinkKind;
  embed: boolean;
};

export type OrphanRow = { path: string; title: string };

export type DuplicateStemRow = { stem: string; paths: string[] };

export type ProblemFamily<T> = { rows: T[]; total: number };

export type VaultProblems = {
  unresolvedLinks: ProblemFamily<UnresolvedLinkRow>;
  missingEmbeds: ProblemFamily<UnresolvedLinkRow>;
  orphans: ProblemFamily<OrphanRow>;
  duplicateStems: ProblemFamily<DuplicateStemRow>;
};

export interface ProblemsGraph {
  wikiTargets(): WikiTarget[];
  forwardLinks(path: string): ForwardLinkEntry[];
  backlinks(path: string): BacklinkEntry[];
}

export interface VaultProblemsOptions {
  limit: number;
  // dailies and templates are orphans by design; they count only when asked
  includeConventionFolders?: boolean;
}

export const CONVENTION_FOLDERS: readonly string[] = [DAILY_NOTES_FOLDER, TEMPLATES_FOLDER];

export function isConventionFolderPath(path: string): boolean {
  return CONVENTION_FOLDERS.some((folder) => path.startsWith(`${folder}/`));
}

// a dangling target that names a file, or is embedded, is an attachment that went missing
function isMissingEmbed(link: ForwardLinkEntry): boolean {
  if (link.embed) return true;
  const ext = extnamePath(link.target);
  return ext !== "" && !isDocPath(link.target);
}

function capped<T>(rows: T[], limit: number): ProblemFamily<T> {
  return { rows: rows.slice(0, limit), total: rows.length };
}

export function collectVaultProblems(
  graph: ProblemsGraph,
  options: VaultProblemsOptions,
): VaultProblems {
  const docs = graph.wikiTargets().filter((target) => target.type === "doc");
  const unresolvedLinks: UnresolvedLinkRow[] = [];
  const missingEmbeds: UnresolvedLinkRow[] = [];
  const orphans: OrphanRow[] = [];
  const byStem = new Map<string, string[]>();

  for (const doc of docs) {
    // once per source and target: a note naming [[Nowhere]] twice is one problem
    const seen = new Set<string>();
    for (const link of graph.forwardLinks(doc.path)) {
      if (link.targetPath !== null) continue;
      const missing = isMissingEmbed(link);
      const key = `${missing ? "embed" : "link"} ${link.target.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (missing ? missingEmbeds : unresolvedLinks).push({
        sourcePath: doc.path,
        sourceTitle: doc.title,
        target: link.target,
        line: link.line,
        snippet: link.snippet,
        kind: link.kind,
        embed: link.embed,
      });
    }

    if (options.includeConventionFolders === true || !isConventionFolderPath(doc.path)) {
      const linkedFromElsewhere = graph
        .backlinks(doc.path)
        .some((backlink) => backlink.sourcePath !== doc.path);
      if (!linkedFromElsewhere) orphans.push({ path: doc.path, title: doc.title });
    }

    const stem = docStem(doc.path).toLowerCase();
    const paths = byStem.get(stem);
    if (paths === undefined) byStem.set(stem, [doc.path]);
    else paths.push(doc.path);
  }

  const duplicateStems: DuplicateStemRow[] = [];
  for (const paths of byStem.values()) {
    const first = paths[0];
    if (paths.length < 2 || first === undefined) continue;
    duplicateStems.push({ stem: docStem(first), paths });
  }

  return {
    unresolvedLinks: capped(unresolvedLinks, options.limit),
    missingEmbeds: capped(missingEmbeds, options.limit),
    orphans: capped(orphans, options.limit),
    duplicateStems: capped(duplicateStems, options.limit),
  };
}
