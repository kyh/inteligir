// `inteligir trash …` — the vault's Trash/ folder: what is in it, restore,
// and delete-for-good. Trashing itself rides `vault delete`'s surface in the
// app; here the parity verbs are the ones the panel offers.

import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

export function trashCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "trash", description: "Deleted notes: list, restore, purge (30-day retention)" },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "Notes currently in the trash" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.trashList();
          if (outputJson(args, body)) {
            return;
          }
          if (body.entries.length === 0) {
            out.info("The trash is empty.");
            return;
          }
          writeLines(
            body.entries.map(
              (entry) =>
                `${entry.path}  (from ${entry.trashedFrom ?? "?"}, at ${entry.trashedAt ?? "?"})`,
            ),
          );
        },
      }),

      put: defineCommand({
        meta: { name: "put", description: "Move a note into the trash" },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.trash({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Trashed ${args.path} -> ${body.path}`);
        },
      }),

      restore: defineCommand({
        meta: { name: "restore", description: "Move a trashed note back where it came from" },
        args: {
          path: { type: "positional", required: true, description: "The Trash/-relative path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.trashRestore({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Restored ${args.path} -> ${body.path}`);
        },
      }),

      purge: defineCommand({
        meta: { name: "purge", description: "Delete a trashed note for good" },
        args: {
          path: { type: "positional", required: true, description: "The Trash/-relative path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.trashPurge({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Purged ${args.path}`);
        },
      }),
    },
  });
}
