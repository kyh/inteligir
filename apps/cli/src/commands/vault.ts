// `inteligir vault …` — file CRUD plus the git sync surface, one leaf per
// contract row. Human output stays one-line-per-fact so shell pipelines can
// consume it without --json.

import { buffer } from "node:stream/consumers";
import {
  VAULT_MAX_CONTENT_LENGTH,
  type VaultHistoryRequest,
  type VaultStatusResponse,
} from "@repo/api/local/vault/vault-schema";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines, writeOut } from "../output";

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

/** A count flag, parsed HERE rather than sent as a string: citty hands every
 *  flag over as text, and the contract's own bound is what refuses the rest. */
function positiveInteger(raw: string, flag: string, floor: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < floor) {
    throw invalidUsage(`${flag} takes an integer of at least ${String(floor)}; got ${raw}`);
  }
  return value;
}

function assertContentWithinBound(content: string): void {
  const byteLength = new TextEncoder().encode(content).byteLength;
  if (byteLength > VAULT_MAX_CONTENT_LENGTH) {
    throw invalidUsage(
      `--content is ${byteLength} bytes; the vault refuses anything over ${VAULT_MAX_CONTENT_LENGTH}`,
    );
  }
}

export function vaultCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "vault", description: "Files in the vault (markdown on disk)" },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "List the vault tree (folders end with /)" },
        args: {
          dir: {
            type: "positional",
            required: false,
            description: "Only this folder's subtree",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const tree = await api.vault.tree();
          const prefix = args.dir?.replace(/\/+$/u, "");
          const entries =
            prefix === undefined || prefix.length === 0
              ? tree.entries
              : tree.entries.filter(
                  (entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`),
                );
          if (outputJson(args, { root: tree.root, entries })) {
            return;
          }
          writeLines(
            entries.map((entry) => (entry.kind === "dir" ? `${entry.path}/` : entry.path)),
          );
        },
      }),

      read: defineCommand({
        meta: { name: "read", description: "Print a file's content" },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.read({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          writeOut(body.content);
        },
      }),

      history: defineCommand({
        meta: {
          name: "history",
          description: "List a note's commits, newest first, following renames",
        },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          skip: { type: "string", description: "Skip this many revisions" },
          limit: { type: "string", description: "How many revisions to answer" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const request: VaultHistoryRequest = { path: args.path };
          if (args.skip !== undefined) request.skip = positiveInteger(args.skip, "--skip", 0);
          if (args.limit !== undefined) request.limit = positiveInteger(args.limit, "--limit", 1);
          const api = apiFor(deps);
          const body = await api.vault.history(request);
          if (outputJson(args, body)) {
            return;
          }
          // TAB-separated, one revision per line: the sha comes first because
          // it is what `vault revision` takes, so `cut -f1` is the whole
          // pipeline. The path is carried because `--follow` crosses renames
          // and the read needs the path AT that revision.
          writeLines(
            body.revisions.map((revision) =>
              [
                revision.sha,
                revision.authoredAt,
                revision.authorName,
                revision.path,
                revision.subject,
              ].join("\t"),
            ),
          );
        },
      }),

      revision: defineCommand({
        meta: {
          name: "revision",
          description: "Print what a note held at one revision (restore: pipe into `vault write`)",
        },
        args: {
          path: {
            type: "positional",
            required: true,
            description: "The path AT that revision, as `vault history` reports it",
          },
          sha: { type: "positional", required: true, description: "The revision's commit sha" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.revision({ path: args.path, sha: args.sha });
          if (outputJson(args, body)) {
            return;
          }
          writeOut(body.content);
        },
      }),

      write: defineCommand({
        meta: {
          name: "write",
          description: "Write a file (content from --content, else stdin); parents are created",
        },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          content: {
            type: "string",
            description: "The content to write; omitted means read stdin",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          let content: string;
          if (args.content === undefined) {
            content = await readContentFromStdin();
          } else {
            assertContentWithinBound(args.content);
            content = args.content;
          }
          const api = apiFor(deps);
          const body = await api.vault.write({ path: args.path, content });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Wrote ${body.path}`);
        },
      }),

      rename: defineCommand({
        meta: {
          name: "rename",
          description: "Rename/move a note; wiki links into it are rewritten",
        },
        args: {
          from: { type: "positional", required: true, description: "The current path" },
          to: { type: "positional", required: true, description: "The new path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.rename({ from: args.from, to: args.to });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Renamed ${args.from} -> ${body.path}`);
          writeLines([
            ...body.rewritten.map((rewritten) => `  rewrote links in ${rewritten}`),
            ...body.skipped.map((skipped) => `  skipped ${skipped.path} (${skipped.reason})`),
          ]);
        },
      }),

      delete: defineCommand({
        meta: { name: "delete", description: "Delete a file or folder" },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.remove({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Deleted ${args.path}`);
        },
      }),

      mkdir: defineCommand({
        meta: { name: "mkdir", description: "Create a folder" },
        args: {
          path: { type: "positional", required: true, description: "The vault-relative path" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.mkdir({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Created ${body.path}/`);
        },
      }),

      status: defineCommand({
        meta: { name: "status", description: "Git sync state (remote, dirty, conflicts)" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.status();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(renderVaultStatus(body));
        },
      }),

      sync: defineCommand({
        meta: { name: "sync", description: "Sync against the configured remote now" },
        args: { ...jsonArg },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.syncNow();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(renderVaultStatus(body));
        },
      }),
    },
  });
}
