import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "./repo";

export const UI_DIR = "packages/ui";
export const UI_PACKAGE = "@repo/ui";

// a gallery proves a component renders, not that the product needs it, so the orphan guard does not
// count it as a consumer.
export const GALLERY_DIR = "apps/web/src/components/gallery";

// held whole by owner decision, listed per file so an unlisted unwired component still fails; a
// held file is not a consumer, and it keeps its own type sizes until a surface draws it.
export const AWAITING_CONSUMER: ReadonlySet<string> = new Set([
  "packages/ui/src/ai/chat.tsx",
  "packages/ui/src/ai/code-block.tsx",
  "packages/ui/src/ai/context-cards.tsx",
  "packages/ui/src/ai/diff-table.tsx",
  "packages/ui/src/ai/filter-table.tsx",
  "packages/ui/src/ai/fine-tune-card.tsx",
  "packages/ui/src/ai/flowchart.tsx",
  "packages/ui/src/ai/glide-list.tsx",
  "packages/ui/src/ai/insight-cards.tsx",
  "packages/ui/src/ai/prompt-bar.tsx",
  "packages/ui/src/ai/recommendation-card.tsx",
  "packages/ui/src/ai/records-table.tsx",
  "packages/ui/src/ai/search.tsx",
  "packages/ui/src/ai/selection-actions.tsx",
  "packages/ui/src/ai/sidebar-nav.tsx",
]);

export interface UiRoot {
  dir: string;
  subpath: string;
}

export const sweptRoots = (): UiRoot[] => {
  const manifestPath = path.join(REPO_ROOT, UI_DIR, "package.json");
  const parsed = z
    .looseObject({ exports: z.record(z.string(), z.string()) })
    .safeParse(JSON.parse(fs.readFileSync(manifestPath, "utf-8")));
  if (!parsed.success) {
    throw new Error(`${manifestPath}: expected an "exports" map of subpath → file`);
  }
  const roots: UiRoot[] = [];
  for (const [key, target] of Object.entries(parsed.data.exports)) {
    const dir = /^\.\/(?<dir>[\w-]+)\/\*$/u.exec(key)?.groups?.dir;
    if (dir !== undefined && target.startsWith("./src/")) {
      roots.push({ dir, subpath: dir });
    }
  }
  if (roots.length === 0) {
    throw new Error(
      `${manifestPath}: no "./<dir>/*" wildcard exports found — the guards have nothing to sweep`,
    );
  }
  return roots;
};
