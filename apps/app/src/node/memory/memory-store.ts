// Reading the agent's memory directory: glob the flat `*.md` files, parse each
// one's frontmatter into a typed fact, and delete one by name. That is the
// WHOLE store — there is no index file to maintain, because the files ARE the
// source of truth (issue #575). Every read globs the directory fresh, so a
// fact the agent just wrote with its shell is visible on the next read with no
// invalidation to wire.
//
// VALIDATION IS AT READ, at the boundary: the agent writes raw markdown here
// exactly as it writes the vault, so a file that is not a well-formed fact is
// surfaced as malformed (with the reason) rather than dropped — a human sees it
// in Settings and fixes or deletes it. Nothing here writes a fact; remembering
// is the agent creating a file, and its only write verb is `delete`, which the
// human drives.

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";
import {
  MEMORY_TYPES,
  memoryTypeSchema,
  type MalformedMemory,
  type MemoryEntry,
} from "@repo/server-contract/memory";
import { z } from "zod";
import { errnoCode } from "../errno";
import { relativeUnder } from "../path-containment";

const MEMORY_FILE_EXTENSION = ".md";

/** The frontmatter a fact carries. Lenient on extra keys — the agent may write
 *  its own — but the three it needs are typed, and `description` defaults to
 *  empty so a bare `name`+`type` file is still a valid (if terse) fact. */
const memoryFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  type: memoryTypeSchema,
});

export interface MemoryScan {
  memories: MemoryEntry[];
  malformed: MalformedMemory[];
}

/** The type ordering the injection and the UI both group by; a fact's rank is
 *  its position in the closed vocabulary. */
function typeRank(type: MemoryEntry["type"]): number {
  return MEMORY_TYPES.indexOf(type);
}

/** A one-line reason a file is not a fact, from the first zod issue. */
function frontmatterProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return "not a valid memory file";
  }
  const at = issue.path.join(".");
  return at.length === 0 ? issue.message : `${at}: ${issue.message}`;
}

function parseEntry(file: string, raw: string): MemoryEntry | MalformedMemory {
  const { properties, body } = splitFrontmatter(raw);
  const parsed = memoryFrontmatterSchema.safeParse(properties);
  if (!parsed.success) {
    return { file, problem: frontmatterProblem(parsed.error) };
  }
  return {
    file,
    name: parsed.data.name,
    description: parsed.data.description,
    type: parsed.data.type,
    body,
  };
}

function isMemoryFile(name: string): boolean {
  // Flat, top-level `*.md` only — `.` files (an editor's swap file) and any
  // nested directory are not facts. The convention documented to the agent is
  // one fact per file at the top level.
  return !name.startsWith(".") && extname(name).toLowerCase() === MEMORY_FILE_EXTENSION;
}

/**
 * The whole directory as one read: valid facts and the files that were not,
 * both sorted deterministically (type, then name, then filename) so the
 * injected index and the settings list are stable across reads.
 *
 * A missing directory is an EMPTY scan, not an error: memory is a rebuildable
 * cache the user may never have populated, and the default `~/.inteligir/
 * memory` does not exist until the agent first writes to it.
 */
export function scanMemoryDir(memoryDir: string): MemoryScan {
  let names: string[];
  try {
    names = readdirSync(memoryDir);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return { memories: [], malformed: [] };
    }
    throw error;
  }
  const memories: MemoryEntry[] = [];
  const malformed: MalformedMemory[] = [];
  for (const name of names.filter(isMemoryFile)) {
    let raw: string;
    try {
      raw = readFileSync(join(memoryDir, name), "utf8");
    } catch (error) {
      // A directory named `x.md`, or a file that vanished mid-scan.
      if (errnoCode(error) === "EISDIR" || errnoCode(error) === "ENOENT") {
        continue;
      }
      throw error;
    }
    const entry = parseEntry(name, raw);
    if ("problem" in entry) {
      malformed.push(entry);
    } else {
      memories.push(entry);
    }
  }
  memories.sort(
    (a, b) =>
      typeRank(a.type) - typeRank(b.type) ||
      a.name.localeCompare(b.name) ||
      a.file.localeCompare(b.file),
  );
  malformed.sort((a, b) => a.file.localeCompare(b.file));
  return { memories, malformed };
}

/** The valid facts alone — what the per-turn injection composes from. */
export function readMemoryFacts(memoryDir: string): MemoryEntry[] {
  return scanMemoryDir(memoryDir).memories;
}

/** A delete refused because the name is not a plain child of the memory dir. */
export class InvalidMemoryFileError extends Error {}
/** A delete refused because no such file exists. */
export class MemoryFileNotFoundError extends Error {}

/**
 * Delete one fact by its on-disk filename. The name must be a plain basename
 * of a `.md` file directly under the memory dir — `relativeUnder` refuses a
 * traversal (`../`), an absolute path, and a nested path, so a hostile `file`
 * cannot reach outside the directory the settings surface is looking at.
 */
export function deleteMemoryFile(memoryDir: string, file: string): void {
  const root = resolve(memoryDir);
  const target = resolve(root, file);
  const rel = relativeUnder(root, target);
  if (rel === null || rel.includes("/") || !isMemoryFile(rel)) {
    throw new InvalidMemoryFileError(`"${file}" is not a memory file in this directory`);
  }
  try {
    rmSync(target);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      throw new MemoryFileNotFoundError(`No memory file named "${file}"`);
    }
    throw error;
  }
}
