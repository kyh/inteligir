// The one-shot Moss legacy import over the whole vault: every note runs the
// pure doc pass (@repo/notes/import) and only changed files are written —
// each under `writeIfUnchanged` against the bytes the pass read, so a save
// landing mid-import keeps its content and the file is reported skipped
// rather than clobbered. Dry-run walks and reports without writing.

import { importMossDoc } from "@repo/notes/import/import-moss-doc";
import { parseSidecar, serializeSidecar } from "@repo/notes/comments/sidecar-schema";
import type { CommentSidecar } from "@repo/notes/comments/sidecar-schema";
import type { VaultImportMossFile, VaultImportMossResponse } from "@repo/server-contract/vault";
import type { VaultService } from "./vault-service";

function describeChanges(report: {
  legacyMarkerPairs: number;
  footer: string;
  footerRowsAdded: number;
  laxMarkersNormalized: number;
  tabsNormalized: number;
  htmlHeadersNormalized: number;
}): string[] {
  const notes: string[] = [];
  if (report.legacyMarkerPairs > 0) {
    notes.push(`${report.legacyMarkerPairs} legacy comment range(s) modernized`);
  }
  if (report.footer === "merged") {
    notes.push(`comment footer merged (${report.footerRowsAdded} row(s) added)`);
  }
  if (report.laxMarkersNormalized > 0) {
    notes.push(`${report.laxMarkersNormalized} marker spelling(s) normalized`);
  }
  if (report.tabsNormalized > 0) {
    notes.push(`${report.tabsNormalized} tab-group line(s) normalized`);
  }
  if (report.htmlHeadersNormalized > 0) {
    notes.push(`${report.htmlHeadersNormalized} moss-html header(s) normalized`);
  }
  return notes;
}

export async function runMossImport(
  service: VaultService,
  dryRun: boolean,
): Promise<VaultImportMossResponse> {
  const tree = await service.listTree();
  const notePaths = tree.entries
    .filter((entry) => entry.kind === "file" && entry.path.endsWith(".md"))
    .map((entry) => entry.path);

  const files: VaultImportMossFile[] = [];
  const warnings: string[] = [];
  let changed = 0;

  for (const path of notePaths) {
    const { content: raw } = await service.read(path);

    const sidecarPath = `${path}.comments.json`;
    let sidecar: CommentSidecar = {};
    let sidecarRaw: string | null = null;
    if ((await service.statEntry(sidecarPath)) === "file") {
      sidecarRaw = (await service.read(sidecarPath)).content;
      const parsed = parseSidecar(sidecarRaw);
      if (!parsed.ok) {
        // A footer merge into a sidecar nothing can parse would be the erase
        // the malformed-sidecar rule forbids; the note is left whole.
        warnings.push(`${path}: sidecar unreadable (${parsed.error}) — skipped`);
        continue;
      }
      sidecar = parsed.sidecar;
    }

    const result = importMossDoc(raw, sidecar);
    for (const warning of result.report.warnings) {
      warnings.push(`${path}: ${warning}`);
    }
    if (!result.bodyChanged && !result.sidecarChanged) {
      continue;
    }
    changed++;
    files.push({
      path,
      bodyChanged: result.bodyChanged,
      sidecarChanged: result.sidecarChanged,
      notes: describeChanges(result.report),
    });
    if (dryRun) {
      continue;
    }

    if (result.bodyChanged) {
      const write = await service.writeIfUnchanged(path, raw, result.body);
      if (!write.applied) {
        warnings.push(`${path}: changed while importing — left as it is now`);
        continue;
      }
    }
    if (result.sidecarChanged) {
      const serialized = serializeSidecar(result.sidecar);
      if (sidecarRaw === null) {
        await service.write(sidecarPath, serialized);
      } else {
        const write = await service.writeIfUnchanged(sidecarPath, sidecarRaw, serialized);
        if (!write.applied) {
          warnings.push(`${sidecarPath}: changed while importing — footer rows not merged`);
        }
      }
    }
  }

  return { dryRun, scanned: notePaths.length, changed, files, warnings };
}
