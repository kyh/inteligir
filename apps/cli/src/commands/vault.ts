import { buffer } from "node:stream/consumers";
import { isDefinedError, safe } from "@orpc/client";
import {
  VAULT_HISTORY_DEFAULT_LIMIT,
  VAULT_HISTORY_MAX_LIMIT,
  VAULT_MAX_CONTENT_LENGTH,
  contentHashHex,
  contentHashSchema,
  externalSyncName,
} from "@repo/api/local/vault/vault-schema";
import type {
  ExternalSync,
  VaultHistoryRequest,
  VaultStatusResponse,
  VaultWriteGuard,
} from "@repo/api/local/vault/vault-schema";
import {
  ATTACHMENT_LOCATION_SPELLINGS,
  describeAttachmentLocation,
  formatAttachmentLocation,
  parseAttachmentLocation,
} from "@repo/api/local/vault/attachment-location";
import type { CommentStoreRestore } from "@repo/api/local/vault/restore-comment-store";
import { parseBoundedInteger } from "../args";
import { defineCommand } from "citty";
import { CliExitError, failureFrom, getErrorMessage, invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines, writeOut } from "../output";
import { resolveAppConfig, writeManagedVaultDir } from "../server/config";
import type { ResolveAppConfigArgs } from "../server/config";
import { resolveCheckoutRoot } from "../server/dev-instance";
import { loopbackOrigin, readServerFile } from "../server/server-file";
import {
  planVaultSelection,
  resolveVaultCandidate,
  selectionRefusalMessage,
} from "../server/vault-switch";

const renderVaultStatus = (status: VaultStatusResponse): string[] => {
  const lines = [`state: ${status.state}`];
  if (status.state !== "no-remote") {
    lines.push(`remote: ${status.remote}`);
  } else if (status.externalSync !== null) {
    lines.push(
      `synced by: ${externalSyncName(status.externalSync)}, so the hosted vault stays off`,
    );
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
};

// `fatal` refuses invalid UTF-8 rather than substituting U+FFFD; `ignoreBOM` keeps a leading BOM as content.
// the size bound is checked here too: the server's refusal arrives only after the whole body crossed the socket.
// a terminal would park an agent's shell on a read nobody answers, and a closed stdin reads as nothing: emptying
// a file is spelled out as `--content ''` rather than inferred from a pipe that carried nothing.
const readContentFromStdin = async (): Promise<string> => {
  if (process.stdin.isTTY) {
    throw invalidUsage("no --content and stdin is a terminal; pipe the content or pass --content");
  }
  const bytes = await buffer(process.stdin);
  if (bytes.byteLength === 0) {
    throw invalidUsage("stdin carried no content; pass --content '' to empty a file");
  }
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
};

const assertContentWithinBound = (content: string): void => {
  const { byteLength } = new TextEncoder().encode(content);
  if (byteLength > VAULT_MAX_CONTENT_LENGTH) {
    throw invalidUsage(
      `--content is ${byteLength} bytes; the vault refuses anything over ${VAULT_MAX_CONTENT_LENGTH}`,
    );
  }
};

// the contract's guard is required, so exactly one flag names it, refused here as the schema would
// refuse it, before stdin is read: last-writer-wins is `--overwrite`, never a forgotten flag.
const writeGuard = (args: {
  "expected-hash"?: string | undefined;
  "if-absent"?: boolean | undefined;
  overwrite?: boolean | undefined;
}): VaultWriteGuard => {
  const expectedHash = args["expected-hash"];
  const ifAbsent = args["if-absent"] === true;
  const overwrite = args.overwrite === true;
  const named = [expectedHash !== undefined, ifAbsent, overwrite].filter(Boolean).length;
  if (named === 0) {
    throw invalidUsage(
      "name the write's guard: --if-absent for a new file, --expected-hash <hash> over the bytes you read, or --overwrite",
    );
  }
  if (named > 1) {
    throw invalidUsage(
      "--if-absent, --expected-hash and --overwrite each guard a whole write; name one",
    );
  }
  if (expectedHash === undefined) {
    return ifAbsent ? { kind: "absent" } : { kind: "overwrite" };
  }
  const hash = contentHashSchema.safeParse(expectedHash);
  if (!hash.success) {
    throw invalidUsage(
      `--expected-hash takes the 64 lowercase hex characters \`vault read --json\` answers as hash (got "${expectedHash}")`,
    );
  }
  return { hash: hash.data, kind: "expected" };
};

interface VaultSelection {
  vaultDir: string;
  dataDir: string;
  previousVaultDir: string;
  // the server serving the previous vault, if one is up: a selection never restarts it
  running: { baseUrl: string } | null;
  // another service that syncs the folder, so the hosted vault stays off for it
  externalSync: ExternalSync | null;
  // the folder's own git remote, redacted, which it keeps syncing with
  remote: string | null;
}

// the same plan the shell's switch runs, minus the restart: the root config.json is the selector
// `inteligir serve` reads, so the next boot is on the new vault and a running server is untouched
const selectVault = async (deps: CliDeps, rawDir: string): Promise<VaultSelection> => {
  const configArgs: ResolveAppConfigArgs = { checkoutPath: resolveCheckoutRoot(), env: deps.env };
  if (deps.homeDir !== undefined) {
    configArgs.homeDir = deps.homeDir;
  }
  const current = resolveAppConfig(configArgs);
  let candidate: ReturnType<typeof resolveVaultCandidate>;
  try {
    candidate = resolveVaultCandidate(configArgs, rawDir);
  } catch (error) {
    throw invalidUsage(getErrorMessage(error));
  }
  const plan = planVaultSelection(current, candidate.vaultDir);
  if (plan.kind === "refused") {
    throw invalidUsage(selectionRefusalMessage(plan.reason));
  }
  // loaded here alone: no other verb runs git or judges a folder.
  const { inspectVaultFolder } = await import("../server/vault/folder-facts");
  const facts = await inspectVaultFolder(candidate.vaultDir, {
    cloudUrl: candidate.cloudUrl,
    homeDir: candidate.homeDir,
  });
  writeManagedVaultDir(current.rootDataDir, candidate.vaultDir);
  const server = readServerFile(current.dataDir);
  return {
    dataDir: candidate.dataDir,
    externalSync: facts.externalSync,
    previousVaultDir: current.vaultDir,
    remote: facts.exists ? facts.remote : null,
    running: server === null ? null : { baseUrl: loopbackOrigin(server.port) },
    vaultDir: candidate.vaultDir,
  };
};

// what the next boot will sync the folder with, when that is not the account's hosted vault
const selectionSyncNote = (selection: VaultSelection): string | null => {
  const service = selection.externalSync === null ? null : externalSyncName(selection.externalSync);
  if (selection.remote !== null) {
    return (
      `${selection.remote} is this folder's own git remote, so it syncs there and never with ` +
      `the hosted vault${service === null ? "" : `; ${service} syncs the folder as well`}.`
    );
  }
  return service === null
    ? null
    : `${service} syncs this folder; inteligir will not sync its notes.`;
};

export const vaultCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Files in the vault (markdown on disk)", name: "vault" },
    subCommands: {
      attachments: defineCommand({
        args: {
          location: {
            description: ATTACHMENT_LOCATION_SPELLINGS,
            required: false,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: {
          description: "Where a pasted image lands; with no argument, print the current choice",
          name: "attachments",
        },
        run: async ({ args }) => {
          if (args.location === undefined) {
            const body = await apiFor(deps).vault.prefs();
            if (outputJson(args, body)) {
              return;
            }
            writeOut(`${formatAttachmentLocation(body.attachments)}\n`);
            return;
          }
          const location = parseAttachmentLocation(args.location);
          if (location === null) {
            throw invalidUsage(
              `"${args.location}" is not a location — use ${ATTACHMENT_LOCATION_SPELLINGS}`,
            );
          }
          const body = await apiFor(deps).vault.setPrefs({ attachments: location });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Pasted images land ${describeAttachmentLocation(body.attachments)}.`);
        },
      }),

      delete: defineCommand({
        args: {
          path: { description: "The vault-relative path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Delete a file or folder", name: "delete" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.remove({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Deleted ${args.path}`);
        },
      }),

      deleted: defineCommand({
        args: { ...jsonArg },
        meta: {
          description:
            "Docs no longer on disk, newest deletion first, with the sha that holds them",
          name: "deleted",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.deleted();
          if (outputJson(args, body)) {
            return;
          }
          if (body.entries.length === 0) {
            out.info("Nothing has been deleted.");
            return;
          }
          // sha first so `cut -f1` feeds `vault restore`.
          writeLines(
            body.entries.map((entry) => [entry.sha, entry.deletedAt, entry.path].join("\t")),
          );
        },
      }),

      history: defineCommand({
        args: {
          limit: {
            description: `How many revisions to answer (1–${VAULT_HISTORY_MAX_LIMIT}, default ${VAULT_HISTORY_DEFAULT_LIMIT})`,
            type: "string",
          },
          path: { description: "The vault-relative path", required: true, type: "positional" },
          skip: { description: "Skip this many revisions", type: "string" },
          ...jsonArg,
        },
        meta: {
          description: "List a note's commits, newest first, following renames",
          name: "history",
        },
        run: async ({ args }) => {
          const request: VaultHistoryRequest = { path: args.path };
          if (args.skip !== undefined) {
            request.skip = parseBoundedInteger(args.skip, "--skip", { min: 0 });
          }
          if (args.limit !== undefined) {
            request.limit = parseBoundedInteger(args.limit, "--limit", {
              max: VAULT_HISTORY_MAX_LIMIT,
              min: 1,
            });
          }
          const api = apiFor(deps);
          const body = await api.vault.history(request);
          if (outputJson(args, body)) {
            return;
          }
          // sha first so `cut -f1` feeds `vault revision`; the path is per revision because --follow crosses renames.
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

      list: defineCommand({
        args: {
          dir: {
            description: "Only this folder's subtree",
            required: false,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: { description: "List the vault tree (folders end with /)", name: "list" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const tree = await api.vault.tree();
          const prefix = args.dir?.replace(/\/+$/u, "") ?? "";
          // a mistyped folder would otherwise list nothing, which reads as an empty folder.
          if (
            prefix.length > 0 &&
            !tree.entries.some((entry) => entry.kind === "dir" && entry.path === prefix)
          ) {
            throw new CliExitError(`No folder ${prefix} in the vault`, { code: "NOT_FOUND" });
          }
          const entries =
            prefix.length === 0
              ? tree.entries
              : tree.entries.filter(
                  (entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`),
                );
          if (outputJson(args, { entries, root: tree.root })) {
            return;
          }
          writeLines(
            entries.map((entry) => (entry.kind === "dir" ? `${entry.path}/` : entry.path)),
          );
        },
      }),

      mkdir: defineCommand({
        args: {
          path: { description: "The vault-relative path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Create a folder", name: "mkdir" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.mkdir({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Created ${body.path}/`);
        },
      }),

      "new-id": defineCommand({
        args: {
          path: {
            description: "The copy's vault-relative path",
            required: true,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: {
          description:
            "Give a note that shares another's id (a copied file) its own, with a copy of its comments",
          name: "new-id",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          // dynamic imports: both read frontmatter, and a static one would load yaml before every
          // client verb reads argv (the build refuses that, scripts/build.mjs).
          const [{ frontmatterId }, { giveNoteOwnId }] = await Promise.all([
            import("@repo/notes/markdown/frontmatter"),
            import("@repo/api/local/vault/give-note-own-id"),
          ]);
          const { content } = await api.vault.read({ path: args.path });
          const shared = frontmatterId(content);
          if (shared === null) {
            throw invalidUsage(
              `No id to replace in ${args.path}: its frontmatter has none, or is not valid YAML`,
            );
          }
          const result = await giveNoteOwnId(api, args.path, shared);
          // a note that moved between the two reads is the refusal a guarded write names, so a
          // caller retries it the same way.
          if (result.kind === "changed") {
            throw new CliExitError(`${args.path} changed since it was read; nothing was written`, {
              serverClass: "CAS_MISMATCH",
            });
          }
          if (result.kind === "invalid") {
            throw invalidUsage(`${args.path}'s frontmatter is not valid YAML; nothing was written`);
          }
          if (result.kind === "failed") {
            throw new CliExitError(
              `Could not give ${args.path} its own id: ${getErrorMessage(result.error)}`,
              failureFrom(result.error, "UNEXPECTED"),
            );
          }
          const body = { comments: result.comments, id: result.id, path: args.path };
          if (outputJson(args, body)) {
            return;
          }
          out.success(
            `${args.path} has its own id, ${result.id}${result.comments === "copied" ? ", and a copy of its comments" : ""}`,
          );
        },
      }),

      open: defineCommand({
        args: {
          dir: {
            description: "Absolute path of an existing folder (a ~/ path is fine)",
            required: true,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: {
          description: "Select the vault the next `serve` boots on; a running server is untouched",
          name: "open",
        },
        run: async ({ args }) => {
          const body = await selectVault(deps, args.dir);
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Selected ${body.vaultDir}; the next \`inteligir serve\` boots on it.`);
          writeLines([`  data: ${body.dataDir}`]);
          const syncNote = selectionSyncNote(body);
          if (syncNote !== null) {
            out.info(syncNote);
          }
          if (body.running !== null) {
            out.info(
              `The server at ${body.running.baseUrl} keeps serving ${body.previousVaultDir}; restart it, or reopen Inteligir, to switch.`,
            );
          }
        },
      }),

      read: defineCommand({
        args: {
          path: { description: "The vault-relative path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Print a file's content", name: "read" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.read({ path: args.path });
          // the base a guarded `vault write --expected-hash` carries back.
          if (outputJson(args, { ...body, hash: await contentHashHex(body.content) })) {
            return;
          }
          writeOut(body.content);
        },
      }),

      rename: defineCommand({
        args: {
          from: { description: "The current path", required: true, type: "positional" },
          to: { description: "The new path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Rename/move a note or folder; links into and out of it are rewritten",
          name: "rename",
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

      restore: defineCommand({
        args: {
          path: {
            description: "The note's path TODAY, or the path `vault deleted` lists",
            required: true,
            type: "positional",
          },
          sha: { description: "The revision's commit sha", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Put a note back to what it held at one revision",
          name: "restore",
        },
        // an ordinary guarded write of older bytes, never a server-side restore (a second write path with its own CAS):
        // checkpoint first so the replaced bytes survive as a revision, and carry the base read so a concurrent write is refused.
        // the checkpoint names the note alone: a whole-tree one would sweep a running turn's writes into an auto-commit.
        run: async ({ args }) => {
          const api = apiFor(deps);
          const revision = await api.vault.revision({ path: args.path, sha: args.sha });
          await api.vault.commitNow({ paths: [args.path] });
          const current = await safe(api.vault.read({ path: args.path }));
          let guard: VaultWriteGuard;
          if (current.error === null) {
            guard = { hash: await contentHashHex(current.data.content), kind: "expected" };
          } else if (isDefinedError(current.error) && current.error.code === "NOT_FOUND") {
            // a deleted note has no base to guard against; create-exclusively, so a note that
            // reappeared there in the meantime is refused rather than replaced.
            guard = { kind: "absent" };
          } else {
            throw current.error;
          }
          const body = await api.vault.write({ content: revision.content, guard, path: args.path });
          let comments: CommentStoreRestore = { kind: "none" };
          if (guard.kind === "absent") {
            // dynamic import: it reads frontmatter, and a static one would load yaml before every
            // client verb reads argv (the build refuses that, scripts/build.mjs).
            const { restoreCommentStore } =
              await import("@repo/api/local/vault/restore-comment-store");
            comments = await restoreCommentStore(api, revision.content, args.sha);
          }
          if (comments.kind === "failed") {
            // the note is back either way, so the failure keeps the store refusal's own class, like a send's.
            throw new CliExitError(
              `Restored ${body.path} to ${args.sha}, but not its comments: ${getErrorMessage(comments.error)}`,
              failureFrom(comments.error, "UNEXPECTED"),
            );
          }
          if (outputJson(args, { ...body, comments: comments.kind })) {
            return;
          }
          out.success(
            `Restored ${body.path} to ${args.sha}${comments.kind === "restored" ? ", with its comments" : ""}`,
          );
        },
      }),

      revision: defineCommand({
        args: {
          path: {
            description: "The path AT that revision, as `vault history` reports it",
            required: true,
            type: "positional",
          },
          sha: { description: "The revision's commit sha", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description:
            "Print what a note held at one revision (to put it back, use `vault restore`)",
          name: "revision",
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

      status: defineCommand({
        args: { ...jsonArg },
        meta: { description: "Git sync state (remote, dirty, conflicts)", name: "status" },
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
        args: { ...jsonArg },
        meta: { description: "Sync against the configured remote now", name: "sync" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.vault.syncNow();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(renderVaultStatus(body));
        },
      }),

      write: defineCommand({
        args: {
          content: {
            description: "The content to write; omitted means read stdin",
            type: "string",
          },
          "expected-hash": {
            description:
              "Write only if the file still hashes to this (the hash `vault read --json` answers)",
            type: "string",
          },
          "if-absent": {
            description: "Create only: refuse if something is already at the path",
            type: "boolean",
          },
          overwrite: {
            description: "Replace whatever is at the path: the last writer wins",
            type: "boolean",
          },
          path: { description: "The vault-relative path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description:
            "Write a file (content from --content, else stdin) under one guard; parents are created",
          name: "write",
        },
        run: async ({ args }) => {
          const guard = writeGuard(args);
          let content: string;
          if (args.content === undefined) {
            content = await readContentFromStdin();
          } else {
            assertContentWithinBound(args.content);
            ({ content } = args);
          }
          const api = apiFor(deps);
          const body = await api.vault.write({ content, guard, path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          out.success(`Wrote ${body.path}`);
        },
      }),
    },
  });
