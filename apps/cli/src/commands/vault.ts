// `inteligir vault …` — file CRUD plus the git sync surface, one leaf per
// contract row. Human output stays one-line-per-fact so shell pipelines can
// consume it without --json.

import { text } from "node:stream/consumers";
import type { VaultStatusResponse } from "@repo/server-contract/vault";
import type { Command } from "commander";
import { apiFor, type CliDeps } from "../context";
import { failFromResponse, outputJson, type JsonOutputOptions } from "../output";

interface WriteOptions extends JsonOutputOptions {
  content?: string;
}

function renderVaultStatus(status: VaultStatusResponse): string[] {
  const lines = [`state: ${status.state}`];
  if (status.state !== "no-remote") {
    lines.push(`remote: ${status.remote}`);
  }
  lines.push(
    `last sync: ${status.lastSyncAt === null ? "never" : new Date(status.lastSyncAt).toISOString()}`,
  );
  if (status.lastError !== null) {
    lines.push(`last error: ${status.lastError}`);
  }
  if (status.state === "conflict") {
    lines.push(
      `conflict: ${status.conflict.ours.commits} local vs ${status.conflict.theirs.commits} remote commits`,
      ...status.conflict.files.map((file) => `  both changed: ${file}`),
    );
  }
  return lines;
}

export function registerVaultCommands(program: Command, deps: CliDeps): void {
  const vault = program.command("vault").description("Files in the vault (markdown on disk)");

  vault
    .command("list [dir]")
    .description("List the vault tree (folders end with /)")
    .option("--json", "Print machine-readable JSON output")
    .action(async (dir: string | undefined, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.vault.tree.$get();
      const tree = await response.json();
      const prefix = dir?.replace(/\/+$/u, "");
      const entries =
        prefix === undefined || prefix.length === 0
          ? tree.entries
          : tree.entries.filter(
              (entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`),
            );
      if (outputJson(opts, { root: tree.root, entries })) {
        return;
      }
      for (const entry of entries) {
        console.log(entry.kind === "dir" ? `${entry.path}/` : entry.path);
      }
    });

  vault
    .command("read <path>")
    .description("Print a file's content")
    .option("--json", "Print machine-readable JSON output")
    .action(async (path: string, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.vault.file.$get({ query: { path } });
      if (response.status !== 200) {
        return failFromResponse(response);
      }
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      process.stdout.write(body.content);
    });

  vault
    .command("write <path>")
    .description("Write a file (content from --content, else stdin); parents are created")
    .option("--content <text>", "The content to write; omitted means read stdin")
    .option("--json", "Print machine-readable JSON output")
    .action(async (path: string, opts: WriteOptions) => {
      const content = opts.content ?? (await text(process.stdin));
      const api = await apiFor(deps);
      const response = await api.vault.file.$put({ json: { path, content } });
      if (response.status !== 200) {
        return failFromResponse(response);
      }
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      console.log(`Wrote ${body.path}`);
    });

  vault
    .command("rename <from> <to>")
    .description("Rename/move a note; wiki links into it are rewritten")
    .option("--json", "Print machine-readable JSON output")
    .action(async (from: string, to: string, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.vault.rename.$post({ json: { from, to } });
      if (response.status !== 200) {
        return failFromResponse(response);
      }
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      console.log(`Renamed ${from} -> ${body.path}`);
      for (const rewritten of body.rewritten) {
        console.log(`  rewrote links in ${rewritten}`);
      }
      for (const skipped of body.skipped) {
        console.log(`  skipped ${skipped.path} (${skipped.reason})`);
      }
    });

  vault
    .command("delete <path>")
    .description("Delete a file or folder")
    .option("--json", "Print machine-readable JSON output")
    .action(async (path: string, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.vault.delete.$post({ json: { path } });
      if (response.status !== 200) {
        return failFromResponse(response);
      }
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      console.log(`Deleted ${path}`);
    });

  vault
    .command("mkdir <path>")
    .description("Create a folder")
    .option("--json", "Print machine-readable JSON output")
    .action(async (path: string, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.vault.mkdir.$post({ json: { path } });
      if (response.status !== 200) {
        return failFromResponse(response);
      }
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      console.log(`Created ${body.path}/`);
    });

  vault
    .command("status")
    .description("Git sync state (remote, dirty, conflicts)")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.vault.status.$get();
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      for (const line of renderVaultStatus(body)) {
        console.log(line);
      }
    });

  vault
    .command("sync")
    .description("Sync against the configured remote now")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.vault.sync.$post();
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      for (const line of renderVaultStatus(body)) {
        console.log(line);
      }
    });
}
