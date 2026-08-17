// `inteligir vault …` — file CRUD plus the git sync surface, one leaf per
// contract row. Human output stays one-line-per-fact so shell pipelines can
// consume it without --json.

import { buffer } from "node:stream/consumers";
import { VAULT_MAX_CONTENT_LENGTH, type VaultStatusResponse } from "@repo/server-contract/vault";
import type { Command } from "commander";
import { invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { outputJson, requireOk, type JsonOutputOptions } from "../output";

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

/**
 * stdin is read as BYTES and decoded strictly: `fatal` refuses invalid UTF-8
 * instead of substituting U+FFFD (silent corruption of a file the user asked
 * to store verbatim), and `ignoreBOM` keeps a leading BOM as content rather
 * than eating it. The size bound is checked here too — the server's refusal
 * would arrive only after the whole body crossed the socket.
 */
async function readContentFromStdin(): Promise<string> {
  const bytes = await buffer(process.stdin);
  if (bytes.byteLength > VAULT_MAX_CONTENT_LENGTH) {
    throw invalidUsage(
      `stdin is ${bytes.byteLength} bytes; the vault refuses anything over ${VAULT_MAX_CONTENT_LENGTH}`,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw invalidUsage("stdin is not valid UTF-8; vault files are text");
  }
}

function assertContentWithinBound(content: string): void {
  const byteLength = new TextEncoder().encode(content).byteLength;
  if (byteLength > VAULT_MAX_CONTENT_LENGTH) {
    throw invalidUsage(
      `--content is ${byteLength} bytes; the vault refuses anything over ${VAULT_MAX_CONTENT_LENGTH}`,
    );
  }
}

export function registerVaultCommands(program: Command, deps: CliDeps): void {
  const vault = program.command("vault").description("Files in the vault (markdown on disk)");

  vault
    .command("list [dir]")
    .description("List the vault tree (folders end with /)")
    .option("--json", "Print machine-readable JSON output")
    .action(async (dir: string | undefined, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const tree = await (await requireOk(await api.vault.tree.$get())).json();
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
      const body = await (await requireOk(await api.vault.file.$get({ query: { path } }))).json();
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
      let content: string;
      if (opts.content === undefined) {
        content = await readContentFromStdin();
      } else {
        assertContentWithinBound(opts.content);
        content = opts.content;
      }
      const api = await apiFor(deps);
      const written = await requireOk(await api.vault.file.$put({ json: { path, content } }));
      const body = await written.json();
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
      const renamed = await requireOk(await api.vault.rename.$post({ json: { from, to } }));
      const body = await renamed.json();
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
      const body = await (await requireOk(await api.vault.delete.$post({ json: { path } }))).json();
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
      const body = await (await requireOk(await api.vault.mkdir.$post({ json: { path } }))).json();
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
      const body = await (await requireOk(await api.vault.status.$get())).json();
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
      const body = await (await requireOk(await api.vault.sync.$post())).json();
      if (outputJson(opts, body)) {
        return;
      }
      for (const line of renderVaultStatus(body)) {
        console.log(line);
      }
    });
}
