// every note's text, held on the phone in SQLite so the notes open offline. A refresh diffs the
// hosted tree against the rows by blob oid and fetches only what changed, forty paths to a request
// pinned to the listing's commit. The mirrored commit advances only once every wanted row holds its
// text, so a refresh cut short resumes from the rows still empty. A write the phone lands moves its
// rows at once and stamps them, and a refresh that listed the tree before that landing leaves them
// alone. Pure over the SQL port and the cloud client; the store decides what the screens see.

import { z } from "zod";
import type { CloudClient, CloudFailure } from "@repo/api/cloud/client";
import {
  VAULT_FILE_MAX_BYTES,
  VAULT_FILES_MAX_PATHS,
  VAULT_TREE_MAX_ENTRIES,
} from "@repo/api/cloud/vault/vault-schema";
import type { VaultFilesResponse, VaultTreeResponse } from "@repo/api/cloud/vault/vault-schema";
import { utf8ByteLength } from "@repo/api/cloud/bytes";
import { isCommentsStorePath } from "@repo/notes/comments/sidecar-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { frontmatterAliases } from "@repo/notes/knowledge/link-extract";
import {
  frontmatterYaml,
  noteIdOfProperties,
  parseProperties,
} from "@repo/notes/markdown/frontmatter";
import { migratePhoneDb } from "../lib/phone-db";
import type { SqlDriver, SqlExecutor, SqlValue } from "../lib/sql-driver";

// the Worker keeps a head's whole listing up to this many files; past it, the tree is too large
// to mirror in one pass
const MAX_MIRRORED_FILES = 50_000;
const MAX_TREE_PAGES = Math.ceil(MAX_MIRRORED_FILES / VAULT_TREE_MAX_ENTRIES);

// multi-row statements, under SQLite's 32,766 bound parameters
const UPSERT_ROWS_PER_STATEMENT = 100;
const DELETE_PATHS_PER_STATEMENT = 500;

type TreeEntry = VaultTreeResponse["entries"][number];

export interface MirrorRow extends TreeEntry {
  // the commit this path's blob first appeared at: an asset url pinned to it names the same bytes
  // until the blob changes, so an image's url outlives every commit that leaves it alone
  pinCommit: string;
  noteId: string | null;
  aliases: readonly string[];
}

// over the rows whose text the mirror wants
export interface MirrorProgress {
  fetched: number;
  total: number;
}

interface MirrorSnapshot {
  rows: readonly MirrorRow[];
  // null until one refresh has held every wanted text at one commit
  mirroredCommit: string | null;
  progress: MirrorProgress;
}

// a row the mirror names; `content` is null until its text arrives, and for a file it never fetches
export interface MirrorText {
  path: string;
  oid: string;
  pinCommit: string;
  content: string | null;
}

// true while the sign-in the work started under is still the one it may write for
export type Fence = () => boolean;

type WalkOutcome =
  | { kind: "current" }
  | { kind: "applied"; commit: string; firstMirror: boolean }
  | { kind: "no-vault" }
  | { kind: "too-large" }
  | { kind: "failed"; failure: CloudFailure }
  | { kind: "fenced" };

// `incomplete`: an answer left a wanted row empty; the next refresh asks for it again
type FillOutcome =
  | { kind: "complete" }
  | { kind: "incomplete" }
  | { kind: "failed"; failure: CloudFailure }
  | { kind: "fenced" };

// what a landed write leaves at a path, each pinned to the commit that holds it. `text` is null
// where the phone holds no text for the blob: a move's row keeps the one it has when the blob is
// the same, and a read fetches the rest.
export type MirrorLanding =
  | {
      kind: "put";
      path: string;
      oid: string;
      size: number;
      text: string | null;
      commit: string;
    }
  | { kind: "move"; from: string; to: string; oid: string; text: string | null; commit: string }
  | { kind: "remove"; path: string };

export interface VaultMirror {
  snapshot: () => Promise<MirrorSnapshot>;
  // pages the tree at head and applies it to the rows in one transaction
  walkHead: (client: CloudClient, fence: Fence) => Promise<WalkOutcome>;
  // fetches every wanted row still without its text, at the commit walkHead applied
  fillTexts: (
    client: CloudClient,
    commit: string,
    fence: Fence,
    onProgress: (progress: MirrorProgress) => void,
  ) => Promise<FillOutcome>;
  readText: (path: string) => Promise<MirrorText | null>;
  // every row that holds its text
  readTexts: () => Promise<MirrorText[]>;
  // lands only while the row still names `oid`: a refresh may have moved it on meanwhile
  storeText: (text: { path: string; oid: string; content: string }, fence: Fence) => Promise<void>;
  wipe: () => Promise<void>;
}

export interface NoteFacts {
  noteId: string | null;
  aliases: readonly string[];
}

const aliasesSchema = z.array(z.string());

const snapshotRowSchema = z.object({
  aliases: z.string(),
  note_id: z.string().nullable(),
  oid: z.string(),
  path: z.string(),
  pin_commit: z.string(),
  size: z.number(),
});

const diffRowSchema = z.object({ held: z.number(), oid: z.string(), path: z.string() });

const payloadSchema = z.object({
  aliases: z.string(),
  content: z.string(),
  note_id: z.string().nullable(),
});
type TextPayload = z.infer<typeof payloadSchema>;

const textRowSchema = z.object({
  content: z.string().nullable(),
  oid: z.string(),
  path: z.string(),
  pin_commit: z.string(),
});

const pendingRowSchema = z.object({ oid: z.string(), path: z.string() });

const metaSchema = z.object({ mirrored_commit: z.string().nullable(), tree_commit: z.string() });

const countsSchema = z.object({ fetched: z.number(), total: z.number() });

const markSchema = z.object({ mark: z.number() });

const landedPathSchema = z.object({ path: z.string() });

const movedRowSchema = z.object({
  content: z.string().nullable(),
  oid: z.string(),
  size: z.number(),
});

const parseAliases = (raw: string): readonly string[] => {
  try {
    const parsed = aliasesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

// what the resolver reads off a note: its frontmatter id and aliases
export const noteFactsOf = (content: string): NoteFacts => {
  const yaml = frontmatterYaml(content);
  const properties = yaml === null ? null : parseProperties(yaml);
  return { aliases: frontmatterAliases(properties), noteId: noteIdOfProperties(properties) };
};

// read once per text, when it lands: a listing never re-parses a note
const payloadOf = (content: string): TextPayload => {
  const facts = noteFactsOf(content);
  return { aliases: JSON.stringify(facts.aliases), content, note_id: facts.noteId };
};

const wantsText = (entry: Pick<TreeEntry, "path" | "size">): boolean =>
  (isDocPath(entry.path) || isCommentsStorePath(entry.path)) && entry.size <= VAULT_FILE_MAX_BYTES;

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
};

const placeholders = (count: number, width: number): string => {
  const row = `(${Array.from({ length: width }, () => "?").join(", ")})`;
  return Array.from({ length: count }, () => row).join(", ");
};

interface MirrorMeta {
  tree: string | null;
  mirrored: string | null;
}

const readMeta = async (db: SqlExecutor): Promise<MirrorMeta> => {
  const [row] = await db.all("SELECT tree_commit, mirrored_commit FROM mirror_meta WHERE id = 1");
  if (row === undefined) {
    return { mirrored: null, tree: null };
  }
  const meta = metaSchema.parse(row);
  return { mirrored: meta.mirrored_commit, tree: meta.tree_commit };
};

const readCounts = async (db: SqlExecutor): Promise<MirrorProgress> => {
  const [row] = await db.all(
    "SELECT count(content) AS fetched, count(*) AS total FROM mirror_entries WHERE wants_text = 1",
  );
  return countsSchema.parse(row);
};

// the landing stamp a refresh reads before it lists the tree: a row stamped past it was landed by
// the phone after that listing, which may not hold the write yet
const readLandedMark = async (db: SqlExecutor): Promise<number> => {
  const [row] = await db.all("SELECT coalesce(max(seq), 0) AS mark FROM mirror_landings");
  return markSchema.parse(row).mark;
};

// every row the tree names is written with its path's oid, and a row it no longer names goes,
// except a path the phone landed a write on since `mark`, which keeps the row that landing left. A
// changed blob the mirror already holds under another path (a move, a copy, an undo) is copied
// here rather than fetched; the copies are read before anything is written, since a swap of two
// paths would otherwise read a row already rewritten.
const applyTree = async (
  tx: SqlExecutor,
  commit: string,
  listed: readonly TreeEntry[],
  mark: number,
): Promise<void> => {
  const stamped = await tx.all("SELECT DISTINCT path FROM mirror_landings WHERE seq > ?", [mark]);
  const kept = new Set(stamped.map((row) => landedPathSchema.parse(row).path));
  await tx.run("DELETE FROM mirror_landings WHERE seq <= ?", [mark]);
  const entries = listed.filter((entry) => !kept.has(entry.path));
  const raw = await tx.all("SELECT path, oid, content IS NOT NULL AS held FROM mirror_entries");
  const rows = raw.map((row) => diffRowSchema.parse(row)).filter((row) => !kept.has(row.path));
  const oidAt = new Map(rows.map((row) => [row.path, row.oid]));
  const holderOf = new Map<string, string>();
  for (const row of rows) {
    if (row.held === 1 && !holderOf.has(row.oid)) {
      holderOf.set(row.oid, row.path);
    }
  }

  const changed = entries.filter((entry) => oidAt.get(entry.path) !== entry.oid);
  const copies = new Map<string, TextPayload>();
  for (const entry of changed) {
    const holder = holderOf.get(entry.oid);
    if (holder === undefined || copies.has(entry.oid)) {
      continue;
    }
    const [held] = await tx.all(
      "SELECT content, note_id, aliases FROM mirror_entries WHERE path = ?",
      [holder],
    );
    const parsed = payloadSchema.safeParse(held);
    if (parsed.success) {
      copies.set(entry.oid, parsed.data);
    }
  }

  for (const batch of chunks(changed, UPSERT_ROWS_PER_STATEMENT)) {
    const params: SqlValue[] = [];
    for (const entry of batch) {
      const copy = copies.get(entry.oid);
      params.push(
        entry.path,
        entry.oid,
        entry.size,
        commit,
        wantsText(entry) ? 1 : 0,
        copy?.note_id ?? null,
        copy?.aliases ?? "[]",
        copy?.content ?? null,
      );
    }
    await tx.run(
      `INSERT INTO mirror_entries (path, oid, size, pin_commit, wants_text, note_id, aliases, content)
       VALUES ${placeholders(batch.length, 8)}
       ON CONFLICT (path) DO UPDATE SET
         oid = excluded.oid, size = excluded.size, pin_commit = excluded.pin_commit,
         wants_text = excluded.wants_text, note_id = excluded.note_id,
         aliases = excluded.aliases, content = excluded.content`,
      params,
    );
  }

  const named = new Set(entries.map((entry) => entry.path));
  const gone = rows.filter((row) => !named.has(row.path)).map((row) => row.path);
  for (const batch of chunks(gone, DELETE_PATHS_PER_STATEMENT)) {
    await tx.run(
      `DELETE FROM mirror_entries WHERE path IN (${batch.map(() => "?").join(", ")})`,
      batch,
    );
  }

  await tx.run(
    `INSERT INTO mirror_meta (id, tree_commit) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET tree_commit = excluded.tree_commit`,
    [commit],
  );
};

const upsertRow = async (
  tx: SqlExecutor,
  row: { path: string; oid: string; size: number; commit: string; text: string | null },
): Promise<void> => {
  const wanted = wantsText(row);
  const payload = wanted && row.text !== null ? payloadOf(row.text) : null;
  await tx.run(
    `INSERT INTO mirror_entries (path, oid, size, pin_commit, wants_text, note_id, aliases, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET
       oid = excluded.oid, size = excluded.size, pin_commit = excluded.pin_commit,
       wants_text = excluded.wants_text, note_id = excluded.note_id,
       aliases = excluded.aliases, content = excluded.content`,
    [
      row.path,
      row.oid,
      row.size,
      row.commit,
      wanted ? 1 : 0,
      payload?.note_id ?? null,
      payload?.aliases ?? "[]",
      payload?.content ?? null,
    ],
  );
};

const movedSize = (held: { size: number } | null, text: string | null): number => {
  if (held !== null) {
    return held.size;
  }
  return text === null ? 0 : utf8ByteLength(text);
};

const applyLanding = async (
  tx: SqlExecutor,
  landing: MirrorLanding,
): Promise<readonly string[]> => {
  switch (landing.kind) {
    case "put": {
      await upsertRow(tx, landing);
      return [landing.path];
    }
    case "remove": {
      await tx.run("DELETE FROM mirror_entries WHERE path = ?", [landing.path]);
      return [landing.path];
    }
    case "move": {
      const [raw] = await tx.all("SELECT oid, size, content FROM mirror_entries WHERE path = ?", [
        landing.from,
      ]);
      const parsed = raw === undefined ? null : movedRowSchema.parse(raw);
      const held = parsed?.oid === landing.oid ? parsed : null;
      const text = held === null ? landing.text : held.content;
      await tx.run("DELETE FROM mirror_entries WHERE path = ?", [landing.from]);
      await upsertRow(tx, {
        commit: landing.commit,
        oid: landing.oid,
        path: landing.to,
        size: movedSize(held, text),
        text,
      });
      return [landing.from, landing.to];
    }
    // no default
  }
};

// a row keeps the facts it holds while its blob is the same; a new text is read for them
const landedRow = (
  row: { path: string; oid: string; size: number; commit: string; text: string | null },
  held: MirrorRow | null,
): MirrorRow => {
  let facts: NoteFacts = { aliases: [], noteId: null };
  if (held?.oid === row.oid) {
    facts = { aliases: held.aliases, noteId: held.noteId };
  } else if (row.text !== null && wantsText(row)) {
    facts = noteFactsOf(row.text);
  }
  return { ...facts, oid: row.oid, path: row.path, pinCommit: row.commit, size: row.size };
};

// the same landings over the rows a caller holds in memory, so a listing moves with the write
// rather than waiting for the next snapshot
export const landOnRows = (
  rows: readonly MirrorRow[],
  landings: readonly MirrorLanding[],
): MirrorRow[] => {
  const byPath = new Map(rows.map((row) => [row.path, row]));
  for (const landing of landings) {
    switch (landing.kind) {
      case "put": {
        byPath.set(landing.path, landedRow(landing, byPath.get(landing.path) ?? null));
        break;
      }
      case "remove": {
        byPath.delete(landing.path);
        break;
      }
      case "move": {
        const moving = byPath.get(landing.from) ?? null;
        const held = moving?.oid === landing.oid ? moving : null;
        byPath.delete(landing.from);
        const size = movedSize(held, landing.text);
        byPath.set(landing.to, landedRow({ ...landing, path: landing.to, size }, held));
        break;
      }
      // no default
    }
  }
  return [...byPath.values()].toSorted((a, b) => (a.path < b.path ? -1 : 1));
};

// the rows a landed write leaves, stamped so a refresh listed before it cannot put them back. Runs
// inside the caller's transaction, beside the outbox rows it settles.
export const landInMirror = async (
  tx: SqlExecutor,
  landings: readonly MirrorLanding[],
): Promise<void> => {
  for (const landing of landings) {
    for (const path of await applyLanding(tx, landing)) {
      await tx.run("INSERT INTO mirror_landings (path) VALUES (?)", [path]);
    }
  }
};

// a refused or missing file will not be answered at this commit, so it stops holding the mirror
// back; a read of it asks again on its own
const storeAnswer = async (
  tx: SqlExecutor,
  answer: VaultFilesResponse,
  oidOf: ReadonlyMap<string, string>,
): Promise<void> => {
  for (const file of answer.files) {
    if (oidOf.get(file.path) !== file.oid) {
      continue;
    }
    const payload = payloadOf(file.content);
    await tx.run(
      `UPDATE mirror_entries SET content = ?, note_id = ?, aliases = ?
       WHERE path = ? AND oid = ? AND content IS NULL`,
      [payload.content, payload.note_id, payload.aliases, file.path, file.oid],
    );
  }
  for (const path of [...answer.missing, ...answer.refused.map((refusal) => refusal.path)]) {
    await tx.run("UPDATE mirror_entries SET wants_text = 0 WHERE path = ? AND content IS NULL", [
      path,
    ]);
  }
};

export const createVaultMirror = (db: SqlDriver): VaultMirror => {
  // on the first call, so a failed migration fails the call that asked rather than nobody
  let migrated: Promise<void> | null = null;
  const ready = async (): Promise<void> => {
    migrated ??= migratePhoneDb(db);
    await migrated;
  };

  // the transaction re-checks the fence: a wipe queued ahead of it must win
  const write = async (
    fence: Fence,
    work: (tx: SqlExecutor) => Promise<void>,
  ): Promise<boolean> => {
    const outcome = { landed: false };
    await db.exclusive(async (tx) => {
      if (!fence()) {
        return;
      }
      await work(tx);
      outcome.landed = true;
    });
    return outcome.landed;
  };

  const walkHead: VaultMirror["walkHead"] = async (client, fence) => {
    await ready();
    const meta = await readMeta(db);
    const mark = await readLandedMark(db);
    if (!fence()) {
      return { kind: "fenced" };
    }
    const head = await client.vaultTree({});
    if (!fence()) {
      return { kind: "fenced" };
    }
    if (!head.ok) {
      const noVault = head.failure.kind === "refused" && head.failure.code === "not-found";
      return noVault ? { kind: "no-vault" } : { failure: head.failure, kind: "failed" };
    }
    const { commit } = head.value;
    // head alone could name a commit the rows moved past, if a push ever rewound it
    if (commit === meta.mirrored && commit === meta.tree) {
      return { kind: "current" };
    }
    const entries = [...head.value.entries];
    let after = head.value.next ?? undefined;
    for (let page = 1; page < MAX_TREE_PAGES && after !== undefined; page += 1) {
      const result = await client.vaultTree({ after, ref: commit });
      if (!fence()) {
        return { kind: "fenced" };
      }
      if (!result.ok) {
        return { failure: result.failure, kind: "failed" };
      }
      entries.push(...result.value.entries);
      after = result.value.next ?? undefined;
    }
    if (after !== undefined) {
      return { kind: "too-large" };
    }
    const landed = await write(fence, async (tx) => {
      await applyTree(tx, commit, entries, mark);
    });
    return landed
      ? { commit, firstMirror: meta.mirrored === null, kind: "applied" }
      : { kind: "fenced" };
  };

  const fillTexts: VaultMirror["fillTexts"] = async (client, commit, fence, onProgress) => {
    await ready();
    const empty = await db.all(
      "SELECT path, oid FROM mirror_entries WHERE wants_text = 1 AND content IS NULL ORDER BY path",
    );
    const pending = empty.map((row) => pendingRowSchema.parse(row));
    let progress = await readCounts(db);
    if (!fence()) {
      return { kind: "fenced" };
    }
    onProgress(progress);
    const oidOf = new Map(pending.map((row) => [row.path, row.oid]));
    const queue = pending.map((row) => row.path);

    while (queue.length > 0) {
      const paths = queue.splice(0, VAULT_FILES_MAX_PATHS);
      const result = await client.vaultFiles({ paths, ref: commit });
      if (!fence()) {
        return { kind: "fenced" };
      }
      if (!result.ok) {
        return { failure: result.failure, kind: "failed" };
      }
      const answer = result.value;
      // the Worker always answers the first path, so an answer that settles nothing is not one
      // to ask again
      const settled = answer.files.length + answer.missing.length + answer.refused.length;
      if (answer.commit !== commit || settled === 0) {
        return { kind: "incomplete" };
      }
      if (!(await write(fence, async (tx) => await storeAnswer(tx, answer, oidOf)))) {
        return { kind: "fenced" };
      }
      queue.push(...answer.deferred);
      const fetched = answer.files.filter((file) => oidOf.get(file.path) === file.oid).length;
      progress = {
        fetched: progress.fetched + fetched,
        total: progress.total - answer.missing.length - answer.refused.length,
      };
      onProgress(progress);
    }

    const verdict = { complete: false };
    const landed = await write(fence, async (tx) => {
      const counts = await readCounts(tx);
      const meta = await readMeta(tx);
      if (counts.fetched < counts.total || meta.tree !== commit) {
        return;
      }
      await tx.run("UPDATE mirror_meta SET mirrored_commit = tree_commit WHERE id = 1");
      verdict.complete = true;
    });
    if (!landed) {
      return { kind: "fenced" };
    }
    return verdict.complete ? { kind: "complete" } : { kind: "incomplete" };
  };

  return {
    fillTexts,

    async readText(path) {
      await ready();
      const [row] = await db.all(
        "SELECT path, oid, pin_commit, content FROM mirror_entries WHERE path = ?",
        [path],
      );
      if (row === undefined) {
        return null;
      }
      const parsed = textRowSchema.parse(row);
      return {
        content: parsed.content,
        oid: parsed.oid,
        path: parsed.path,
        pinCommit: parsed.pin_commit,
      };
    },

    async readTexts() {
      await ready();
      const rows = await db.all(
        "SELECT path, oid, pin_commit, content FROM mirror_entries WHERE content IS NOT NULL",
      );
      return rows.map((raw) => {
        const row = textRowSchema.parse(raw);
        return { content: row.content, oid: row.oid, path: row.path, pinCommit: row.pin_commit };
      });
    },

    async snapshot() {
      await ready();
      const listed = await db.all(
        "SELECT path, oid, size, pin_commit, note_id, aliases FROM mirror_entries ORDER BY path",
      );
      const rows = listed.map((raw) => {
        const row = snapshotRowSchema.parse(raw);
        return {
          aliases: parseAliases(row.aliases),
          noteId: row.note_id,
          oid: row.oid,
          path: row.path,
          pinCommit: row.pin_commit,
          size: row.size,
        };
      });
      const meta = await readMeta(db);
      return { mirroredCommit: meta.mirrored, progress: await readCounts(db), rows };
    },

    async storeText(text, fence) {
      await ready();
      const payload = payloadOf(text.content);
      await write(fence, async (tx) => {
        await tx.run(
          "UPDATE mirror_entries SET content = ?, note_id = ?, aliases = ? WHERE path = ? AND oid = ?",
          [payload.content, payload.note_id, payload.aliases, text.path, text.oid],
        );
      });
    },

    walkHead,

    async wipe() {
      await ready();
      await db.exclusive(async (tx) => {
        await tx.exec(
          "DELETE FROM mirror_entries; DELETE FROM mirror_meta; DELETE FROM mirror_landings;",
        );
      });
    },
  };
};
