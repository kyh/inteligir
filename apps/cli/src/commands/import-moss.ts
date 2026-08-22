// `inteligir import-moss` — the one-shot legacy-Moss vault import: modernizes
// pre-modern comment syntax, folds comment footers into sidecars, normalizes
// whitespace-lax spellings. Idempotent, so re-running after a partial pass is
// safe; `--dry-run` reports without writing.

import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, requireOk, writeLines } from "../output";

export function importMossCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "import-moss",
      description: "Migrate legacy Moss syntax in the whole vault (comments, footers, lax forms)",
    },
    args: {
      ...jsonArg,
      "dry-run": {
        type: "boolean",
        description: "Report what would change without writing",
        default: false,
      },
    },
    run: async ({ args }) => {
      const api = await apiFor(deps);
      const body = await (
        await requireOk(await api.vault["import-moss"].$post({ json: { dryRun: args["dry-run"] } }))
      ).json();
      if (outputJson(args, body)) {
        return;
      }
      const verb = body.dryRun ? "would change" : "changed";
      writeLines([
        `scanned ${body.scanned} note(s); ${verb} ${body.changed}`,
        ...body.files.flatMap((file) => [file.path, ...file.notes.map((note) => `  ${note}`)]),
        ...body.warnings.map((warning) => `warning: ${warning}`),
      ]);
      if (!body.dryRun && body.changed > 0) {
        out.success(`imported ${body.changed} note(s)`);
      }
    },
  });
}
